var https = require('https');
var url = require('url');
var fs = require('fs');
var cp = require('child_process');
const formidable = require('formidable');
const path = require('path');
const jwt = require("jsonwebtoken");
const httpProxy = require('http-proxy');
const bcrypt = require("bcrypt");
const { Worker } = require("worker_threads");
const { DATABASE_PASSWORD, ENDPOINT_ZIP_MAX_MEGABYTES, JWT_EXPIRY_SECONDS, ENDPOINT_RESPONSE_MILLISECONDS, JWT_SECRET, MINIMUM_PASSWORD_LENGTH, MAX_JSON_LENGTH, BANNED_SERVICE_UPPERCASE_NAMES, DATABASE_HOST, DATABASE_USER, DATABASE_CONNECTION_LIMIT, PASSWORD_MINIMUM_TIMEOUT_MILLISECONDS, MAX_ENDPOINT_COUNT } = require('./constants');
const RateLimiter = require('./src/ratelimiter');
const sanitizeUrl = require("@braintree/sanitize-url").sanitizeUrl;

const rateLimiter = new RateLimiter();

const proxy = httpProxy.createProxy({ secure: false, proxyTimeout: ENDPOINT_RESPONSE_MILLISECONDS });

proxy.on('error', (err, req, res) => {
	res.writeHead(408, { 'Content-Type': 'text/plain' });
	res.end('Timeout\n');
});

const jwtKey = JWT_SECRET;
const minimumPasswordLength = MINIMUM_PASSWORD_LENGTH;

const endpointReadyMap = new Map();
const serviceReadyMap = new Map();

const mariadb = require('mariadb');
const pool = mariadb.createPool({
	host: DATABASE_HOST,
	user: DATABASE_USER,
	password: DATABASE_PASSWORD,
	connectionLimit: DATABASE_CONNECTION_LIMIT,
	database: 'cleanbase'
});

const jwtExpirySeconds = JWT_EXPIRY_SECONDS;
const uploadDir = path.join(__dirname, '/uploads/');
const maxJsonLength = MAX_JSON_LENGTH;

if (!fs.existsSync(uploadDir)) {
	fs.mkdirSync(uploadDir);
}

const parseJsonSafely = (text, allowedFieldUppercaseSet) => {
	if (text.length > maxJsonLength) {
		return {};
	} else if (/^[\],:{}\s]*$/.test(text.replace(/\\["\\/bfnrtu]/g, '@').
		replace(/"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g, ']').
		replace(/(?:^|:|,)(?:\s*\[)+/g, ''))) {
		const obj = JSON.parse(text, (key, value) => {
			if (allowedFieldUppercaseSet.has(key.toUpperCase())) {
				return value;
			}

			return undefined;
		});

		return obj;
	}

	return {};
}

const uploadMedia = async (req, res, isCreatingEndpoint = false) => {
	const startDate = new Date();

	const form = new formidable.IncomingForm();
	form.maxFileSize = ENDPOINT_ZIP_MAX_MEGABYTES * 1024 * 1024;
	form.keepExtensions = true;
	form.multiples = true;
	form.uploadDir = uploadDir;

	let nameMap = new Map();

	form.parse(req, async (err, fields, files) => {
		if (err) {
			res.writeHead(500, { 'Content-Type': 'text/plain' });
			res.end('error\n');

			console.log(err);

			return null;
		}

		if (Object.keys(files).length === 0) return res.status(400).json({ message: "no files uploaded" });

		// Iterate all uploaded files and get their path, extension, final extraction path
		let filesInfo = Object.keys(files).map((key) => {
			const file = files[key];
			const filePath = file.path;
			const fileExt = path.extname(file.originalFilename);
			const fileName = path.basename(file.originalFilename, fileExt);

			return { filePath, fileExt, fileName };
		});

		if (filesInfo.length > 1) {
			filesInfo = [filesInfo[0]];
		}

		// Check whether uploaded files are zip files
		const validFiles = filesInfo.every(({ fileExt }) => fileExt === '.zip');

		// if uploaded files are not zip files, return error
		if (!validFiles) {
			res.writeHead(500, { 'Content-Type': 'text/plain' });
			res.end('unsupported file type\n');

			return null;
		}

		if (isCreatingEndpoint) {
			const name = nameMap.get(filesInfo[0].filePath);

			let conn;
			try {
				conn = await pool.getConnection();

				const serviceRows = await conn.query("SELECT service_password from tbl_service WHERE service_name = ?", [
					serviceSegment
				]);

				if (serviceRows.length > 0) {
					const password = serviceRows[0].service_password;

					const validPassword = await bcrypt.compare(name, password);
					if (validPassword) {
					} else {
						const rows = await conn.query("SELECT tbl_service.id from tbl_service LEFT JOIN tbl_endpoint ON service_id = tbl_service.id where service_name = ? and service_endpoint = ?", [
							serviceSegment, endpointSegment
						]);

						if (rows.length > 0) {
							const serviceId = rows[0].id;

							console.log('DELETE: DELETE FROM tbl_endpoint WHERE service_id = ' + serviceId + ' AND service_endpoint = ' + endpointSegment);

							const deleteRows = await conn.query("DELETE FROM tbl_endpoint WHERE service_id = ? AND service_endpoint = ?", [
								serviceId, endpointSegment
							]);
						}

						res.writeHead(500, { 'Content-Type': 'text/plain' });
						res.end('error\n');
						return null;
					}
				}
			} catch (err) {
				throw err;
			} finally {
				if (conn) conn.end();
			}
		}

		res.writeHead(200, { 'Content-Type': 'text/plain' });
		res.end('uploaded\n');

		const endDate = new Date();
		console.log('Formidable time ellapsed: ' + (endDate - startDate));

		// iterate through each file path and extract them
		filesInfo.forEach(({ filePath, fileName }) => {
			const worker = new Worker(
				__dirname + "/workers/endpoint_worker.js",
				{
					workerData: {
						filePath,
						fileName
					}
				}
			);
			worker.on("message", msg => {
				if (msg.endpointSegment !== null && msg.endpointSegment !== undefined) {
					const endpointSegment = msg.endpointSegment;
					const ready = msg.ready;
					endpointReadyMap.set(endpointSegment, ready);
					console.log('Main thread: ' + endpointSegment + ': ' + ready);
				}
			});
		});
	});

	var url_parts = url.parse(sanitizeUrl(req.url));
	url_parts = url_parts.path;
	url_parts = url_parts.split('/');
	const serviceSegment = url_parts[1];
	const endpointSegment = url_parts[2];

	form.on('fileBegin', function (name, file) {
		file.path = path.join(uploadDir, serviceSegment + '_' + endpointSegment + '_build.zip');
		file.newFilename = serviceSegment + '_' + endpointSegment + '_build.zip';
		file.filepath = path.join(uploadDir, serviceSegment + '_' + endpointSegment + '_build.zip');

		nameMap.set(file.path, name);

		try {
			fs.unlinkSync(file.filepath);
		} catch (err) {
		}
	});
}

async function createService(serviceName, servicePassword, superuserId) {
	let conn;
	try {
		conn = await pool.getConnection();

		const rows = await conn.query("SELECT service_name from tbl_service WHERE service_name = ?", [
			serviceName
		]);

		if (rows.length === 0) {
			const salt = await bcrypt.genSalt(10);
			const hashedPass = await bcrypt.hash(servicePassword, salt);

			const res = await conn.query("INSERT INTO tbl_service (service_name, service_password, superuser_id) VALUES (?, ?, ?)", [serviceName, hashedPass, superuserId]);

			cp.exec('./scripts/createservice.sh ' + serviceName + ' ' + servicePassword, (error, stdout, stderr) => {
				if (error) {
					console.log('Error in removing files');
					return;
				}
				if (stderr) {
					console.log('Has stderr output');
					console.log(stderr);
				}

				serviceReadyMap.set(serviceName, true);
			});
		} else {
		}
	} catch (err) {
		throw err;
	} finally {
		if (conn) return conn.end();
	}
}

async function createEndpoint(req, res) {
	let conn;
	try {
		conn = await pool.getConnection();

		const countRows = await conn.query("SELECT COUNT(*) AS count from tbl_endpoint");

		let endpointCount;

		if (countRows.length > 0) {
			endpointCount = countRows[0].count;
		} else {
			endpointCount = 0;
		}

		if (endpointCount >= MAX_ENDPOINT_COUNT) {
			return null;
		}

		const rows = await conn.query("SELECT service_port from tbl_endpoint ORDER BY service_port DESC");

		let maxPort;

		if (rows.length > 0) {
			maxPort = rows[0].service_port;
		} else {
			maxPort = 2999;
		}

		if (rows.length === 0 || maxPort < 3125) {
			var url_parts = url.parse(sanitizeUrl(req.url));
			url_parts = url_parts.path;
			url_parts = url_parts.split('/');
			const serviceSegment = url_parts[1];
			const endpointSegment = url_parts[2];

			const endpointFormatted = endpointSegment.replace(/[^a-z0-9]/gi, '');

			const serviceRows = await conn.query("SELECT id from tbl_service WHERE service_name = ?", [
				serviceSegment
			]);

			if (serviceRows.length > 0 && endpointSegment.length === endpointFormatted.length) {
				const serviceId = serviceRows[0].id;

				const endpointRows = await conn.query("SELECT service_endpoint from tbl_endpoint WHERE service_id = ? AND service_endpoint = ?", [
					serviceId, endpointSegment
				]);

				if (endpointRows.length === 0) {
					maxPort++;
					const res = await conn.query("INSERT INTO tbl_endpoint (service_id, service_port, service_endpoint, build_path) VALUES (?, ?, ?, ?)", [
						serviceId, maxPort, endpointSegment, './uploads/' + serviceSegment + '_' + endpointSegment + '_build.zip'
					]);

					return maxPort;
				}
			}
		} else {
		}
	} catch (err) {
		throw err;
	} finally {
		if (conn) conn.end();
	}

	return null;
}


async function removeEndpoint(req, res, postBody) {
	if (!postBody || !postBody.password || postBody.password === '') {
		return;
	}

	let conn;
	try {
		conn = await pool.getConnection();

		var url_parts = url.parse(sanitizeUrl(req.url));
		url_parts = url_parts.path;
		url_parts = url_parts.split('/');
		const serviceSegment = url_parts[1];
		const endpointSegment = url_parts[2];

		const endpointFormatted = endpointSegment.replace(/[^a-z0-9]/gi, '');

		const serviceRows = await conn.query("SELECT id, service_password from tbl_service WHERE service_name = ?", [
			serviceSegment
		]);

		if (serviceRows.length > 0 && endpointSegment.length === endpointFormatted.length) {
			const serviceId = serviceRows[0].id;
			const password = serviceRows[0].service_password;

			const validPassword = await bcrypt.compare(postBody.password, password);
			if (validPassword) {
				const endpointRows = await conn.query("SELECT service_endpoint, service_port, build_path from tbl_endpoint WHERE service_id = ? AND service_endpoint = ?", [
					serviceId, endpointSegment
				]);

				if (endpointRows.length > 0) {
					const port = endpointRows[0].service_port;
					const buildPath = endpointRows[0].build_path;

					const res = await conn.query("DELETE FROM tbl_endpoint WHERE service_endpoint = ? and service_id = ?", [
						endpointSegment, serviceId
					]);

					endpointReadyMap.set(endpointSegment, false);

					const worker = new Worker(
						__dirname + "/workers/remove_endpoint_worker.js",
						{
							workerData: {
								endpointSegment,
								port,
								buildPath
							}
						}
					);
					worker.on("message", msg => {
						if (msg.endpointSegment !== null && msg.endpointSegment !== undefined) {
							endpointReadyMap.delete(msg.endpointSegment);
						}
					});
				}
			}
		}
	} catch (err) {
		throw err;
	} finally {
		if (conn) conn.end();
	}

	return null;
}

async function restartEndpoint(req, res, postBody) {
	if (!postBody || !postBody.password || postBody.password === '') {
		return;
	}

	let conn;
	try {
		conn = await pool.getConnection();

		var url_parts = url.parse(sanitizeUrl(req.url));
		url_parts = url_parts.path;
		url_parts = url_parts.split('/');
		const serviceSegment = url_parts[1];
		const endpointSegment = url_parts[2];

		const endpointFormatted = endpointSegment.replace(/[^a-z0-9]/gi, '');

		const serviceRows = await conn.query("SELECT id, service_password from tbl_service WHERE service_name = ?", [
			serviceSegment
		]);

		if (serviceRows.length > 0 && endpointSegment.length === endpointFormatted.length) {
			const serviceId = serviceRows[0].id;
			const password = serviceRows[0].service_password;

			const validPassword = await bcrypt.compare(postBody.password, password);
			if (validPassword) {
				const endpointRows = await conn.query("SELECT service_port from tbl_endpoint WHERE service_id = ? AND service_endpoint = ?", [
					serviceId, endpointSegment
				]);

				if (endpointRows.length > 0) {
					const port = endpointRows[0].service_port;

					const worker = new Worker(
						__dirname + "/workers/restart_endpoint_worker.js",
						{
							workerData: {
								port,
								endpointSegment
							}
						}
					);
					worker.on("message", msg => {
						if (msg.endpointSegment !== null && msg.endpointSegment !== undefined) {
							const endpointSegment = msg.endpointSegment;
							const ready = msg.ready;
							endpointReadyMap.set(endpointSegment, ready);
							console.log('Main thread: ' + endpointSegment + ': ' + ready);
						}
					});
				}
			}
		}
	} catch (err) {
		throw err;
	} finally {
		if (conn) conn.end();
	}

	return null;
}

async function addUser(req, postBody) {
	if (!postBody || !postBody.password || !postBody.username || !postBody.userPassword) {
		return;
	}

	var url_parts = url.parse(sanitizeUrl(req.url));
	url_parts = url_parts.path;
	url_parts = url_parts.split('/');
	const serviceSegment = url_parts[2];

	if (!serviceSegment || serviceSegment === '' || serviceSegment.length < 6 || serviceSegment.length > 32) {
		return;
	}

	let conn;
	try {
		conn = await pool.getConnection();

		const rows = await conn.query("SELECT id, service_password from tbl_service where service_name = ?", [
			serviceSegment
		]);

		let id, password;

		if (rows.length > 0) {
			id = rows[0].id;
			password = rows[0].service_password;
		}

		if (!id || id < 1 || !password) {
			return;
		}

		// check user password with hashed password stored in the database
		const validPassword = await bcrypt.compare(postBody.password, password);
		if (validPassword) {
		} else {
			return;
		}

		const username = postBody.username;
		const userPass = postBody.userPassword;

		let userLevel = postBody.userLevel;

		if (userLevel === null || userLevel === undefined || typeof userLevel !== 'number' || userLevel < 1 || userLevel > 10) {
			if (userLevel === null || userLevel === undefined) {
				userLevel = 1;
			} else if (typeof userLevel === 'number' && userLevel > 10) {
				userLevel = 10;
			} else if (typeof userLevel === 'number' && userLevel < 1) {
				userLevel = 1;
			} else if (typeof userLevel !== 'number') {
				userLevel = 1;
			}
		}

		const usernameFormatted = username.replace(/[^a-z0-9]/gi, '');

		if (usernameFormatted === username && username.length >= 6 && username.length <= 32 && userPass.length >= minimumPasswordLength && userPass.length <= 32) {
			const existingRows = await conn.query("SELECT user_name from tbl_user where service_id = ? and user_name = ?", [
				id, username
			]);

			if (existingRows.length == 0) {
				const salt = await bcrypt.genSalt(10);
				const hashedPass = await bcrypt.hash(userPass, salt);

				const res = await conn.query("INSERT INTO tbl_user (user_name, user_password, service_id, user_level) VALUES (?, ?, ?, ?)", [
					username, hashedPass, id, userLevel
				]);

				return true;
			}
		}
	} catch (err) {
		throw err;
	} finally {
		if (conn) conn.end();
	}

	return null;
}

async function updateUser(req, postBody) {
	if (!postBody || !postBody.username || !postBody.userPassword || !postBody.newPassword || !postBody.password) {
		return;
	}

	var url_parts = url.parse(sanitizeUrl(req.url));
	url_parts = url_parts.path;
	url_parts = url_parts.split('/');
	const serviceSegment = url_parts[2];

	if (!serviceSegment || serviceSegment === '' || serviceSegment.length < 6 || serviceSegment.length > 32) {
		return;
	}

	let conn;
	try {
		conn = await pool.getConnection();

		const rows = await conn.query("SELECT id, service_password from tbl_service where service_name = ?", [
			serviceSegment
		]);

		let id, password;

		if (rows.length > 0) {
			id = rows[0].id;
			password = rows[0].service_password;
		}

		if (!id || id < 1 || !password) {
			return;
		}

		// check user password with hashed password stored in the database
		const validPassword = await bcrypt.compare(postBody.password, password);
		if (validPassword) {
		} else {
			return;
		}

		const username = postBody.username;
		const userPass = postBody.userPassword;

		const usernameFormatted = username.replace(/[^a-z0-9]/gi, '');

		const newPass = postBody.newPassword;

		if (usernameFormatted === username && username.length >= 6 && username.length <= 32 && userPass.length >= minimumPasswordLength && userPass.length <= 32) {
			const existingRows = await conn.query("SELECT user_name, user_password, id from tbl_user where service_id = ? and user_name = ?", [
				id, username
			]);

			if (existingRows.length === 1 && existingRows[0].user_password && existingRows[0].id && existingRows[0].id > 0) {
				const validPassword = await bcrypt.compare(userPass, existingRows[0].user_password);
				if (validPassword) {
					if (newPass.length >= minimumPasswordLength && newPass.length <= 32) {
						const salt = await bcrypt.genSalt(10);
						const hashedPass = await bcrypt.hash(newPass, salt);

						const res = await conn.query("UPDATE tbl_user SET user_password = ? WHERE user_name = ? AND id = ?", [
							hashedPass, existingRows[0].user_name, existingRows[0].id
						]);

						return true;
					}
				}
			}
		}
	} catch (err) {
		throw err;
	} finally {
		if (conn) conn.end();
	}

	return null;
}

async function resetUser(req, postBody) {
	if (!postBody || !postBody.username || !postBody.newPassword || !postBody.password) {
		return;
	}

	var url_parts = url.parse(sanitizeUrl(req.url));
	url_parts = url_parts.path;
	url_parts = url_parts.split('/');
	const serviceSegment = url_parts[2];

	if (!serviceSegment || serviceSegment === '' || serviceSegment.length < 6 || serviceSegment.length > 32) {
		return;
	}

	let conn;
	try {
		conn = await pool.getConnection();

		const rows = await conn.query("SELECT id, service_password from tbl_service where service_name = ?", [
			serviceSegment
		]);

		let id, password;

		if (rows.length > 0) {
			id = rows[0].id;
			password = rows[0].service_password;
		}

		if (!id || id < 1 || !password) {
			return;
		}

		// check user password with hashed password stored in the database
		const validPassword = await bcrypt.compare(postBody.password, password);
		if (validPassword) {
		} else {
			return;
		}

		const username = postBody.username;
		const usernameFormatted = username.replace(/[^a-z0-9]/gi, '');

		const newPass = postBody.newPassword;

		if (usernameFormatted === username && username.length >= 6 && username.length <= 32) {
			const existingRows = await conn.query("SELECT user_name, id from tbl_user where service_id = ? and user_name = ?", [
				id, username
			]);

			if (existingRows.length === 1 && existingRows[0].id && existingRows[0].id > 0) {
				if (newPass.length >= minimumPasswordLength && newPass.length <= 32) {
					const salt = await bcrypt.genSalt(10);
					const hashedPass = await bcrypt.hash(newPass, salt);

					const res = await conn.query("UPDATE tbl_user SET user_password = ? WHERE user_name = ? AND id = ?", [
						hashedPass, existingRows[0].user_name, existingRows[0].id
					]);

					return true;
				}
			}
		}
	} catch (err) {
		throw err;
	} finally {
		if (conn) conn.end();
	}

	return null;
}

async function removeUser(req, postBody) {
	if (!postBody || !postBody.password || !postBody.username) {
		return;
	}

	var url_parts = url.parse(sanitizeUrl(req.url));
	url_parts = url_parts.path;
	url_parts = url_parts.split('/');
	const serviceSegment = url_parts[2];

	if (!serviceSegment || serviceSegment === '' || serviceSegment.length < 6 || serviceSegment.length > 32) {
		return;
	}

	let conn;
	try {
		conn = await pool.getConnection();

		const rows = await conn.query("SELECT id, service_password from tbl_service where service_name = ?", [
			serviceSegment
		]);

		let id, password;

		if (rows.length > 0) {
			id = rows[0].id;
			password = rows[0].service_password;
		}

		if (!id || id < 1 || !password) {
			return;
		}

		// check user password with hashed password stored in the database
		const validPassword = await bcrypt.compare(postBody.password, password);
		if (validPassword) {
		} else {
			return;
		}

		const username = postBody.username;
		const usernameFormatted = username.replace(/[^a-z0-9]/gi, '');

		if (usernameFormatted === username && username.length >= 6 && username.length <= 32) {
			const existingRows = await conn.query("SELECT id, user_name from tbl_user where service_id = ? and user_name = ?", [
				id, username
			]);

			if (existingRows.length == 1) {
				const res = await conn.query("DELETE FROM tbl_user WHERE id = ? AND user_name = ?", [
					existingRows[0].id, existingRows[0].user_name
				]);
			}
		}
	} catch (err) {
		throw err;
	} finally {
		if (conn) conn.end();
	}

	return null;
}

async function addSuperuser(req, postBody) {
	if (!postBody || !postBody.password || !postBody.username) {
		return;
	}

	let conn;
	try {
		conn = await pool.getConnection();

		const rows = await conn.query("SELECT user_name from tbl_superuser where user_name = ?", [
			postBody.username
		]);

		if (rows.length === 0) {
			const username = postBody.username;
			const userPass = postBody.password;

			const usernameFormatted = username.replace(/[^a-z0-9]/gi, '');

			if (usernameFormatted === username && username.length >= 6 && username.length <= 32 && userPass.length >= minimumPasswordLength && userPass.length <= 32) {
				const salt = await bcrypt.genSalt(10);
				const hashedPass = await bcrypt.hash(userPass, salt);

				const res = await conn.query("INSERT INTO tbl_superuser (user_name, user_password, is_active) VALUES (?, ?, ?)", [
					username, hashedPass, 0
				]);

				return true;
			}
		}
	} catch (err) {
		throw err;
	} finally {
		if (conn) conn.end();
	}

	return null;
}

async function loginSuperuser(req, postBody) {
	if (!postBody || !postBody.username || !postBody.password) {
		return;
	}

	let conn;
	try {
		conn = await pool.getConnection();

		const rows = await conn.query("SELECT id, user_name, user_password, is_active from tbl_superuser where user_name = ?", [
			postBody.username
		]);

		let name, password, active, id;

		if (rows.length === 1) {
			id = rows[0].id;
			name = rows[0].user_name;
			password = rows[0].user_password;
			active = rows[0].is_active;

			const username = postBody.username;
			const userPass = postBody.password;

			const usernameFormatted = username.replace(/[^a-z0-9]/gi, '');

			if ((active === 1 || active === true) && usernameFormatted === username && username.length >= 6 && username.length <= 32 && userPass.length >= minimumPasswordLength && userPass.length <= 32) {
				const timingPromise = new Promise((resolve) => {
					setTimeout(() => {
						resolve(true);
					}, PASSWORD_MINIMUM_TIMEOUT_MILLISECONDS);
				});

				const [validPassword, delayResult] = await Promise.all([
					bcrypt.compare(userPass, password),
					timingPromise
				]);

				if (validPassword) {
					const newToken = jwt.sign({ name, user_id: id }, jwtKey, {
						algorithm: "HS384",
						expiresIn: jwtExpirySeconds,
					});

					return newToken;
				}
			}
		}
	} catch (err) {
		throw err;
	} finally {
		if (conn) conn.end();
	}

	return null;
}

async function loginUser(req, postBody) {
	if (!postBody || !postBody.username || !postBody.userPassword || !postBody.password || postBody.password === '') {
		return;
	}

	var url_parts = url.parse(sanitizeUrl(req.url));
	url_parts = url_parts.path;
	url_parts = url_parts.split('/');
	const serviceSegment = url_parts[2];

	if (!serviceSegment || serviceSegment === '' || serviceSegment.length < 6 || serviceSegment.length > 32) {
		return;
	}

	let conn;
	try {
		conn = await pool.getConnection();

		const rows = await conn.query("SELECT id, service_password from tbl_service where service_name = ?", [
			serviceSegment
		]);

		let id;

		if (rows.length > 0) {
			id = rows[0].id;
		}

		if (!id || id < 1) {
			return;
		}

		const validPassword = await bcrypt.compare(postBody.password, rows[0].service_password);
		if (!validPassword) {
			return;
		}

		const username = postBody.username;
		const userPass = postBody.userPassword;

		const usernameFormatted = username.replace(/[^a-z0-9]/gi, '');

		if (usernameFormatted === username && username.length >= 6 && username.length <= 32 && userPass.length >= minimumPasswordLength && userPass.length <= 32) {
			const existingRows = await conn.query("SELECT user_name, user_password, id, user_level from tbl_user where service_id = ? and user_name = ?", [
				id, username
			]);

			if (existingRows.length > 0 && existingRows[0].user_password && existingRows[0].id && existingRows[0].id > 0) {
				const timingPromise = new Promise((resolve) => {
					setTimeout(() => {
						resolve(true);
					}, PASSWORD_MINIMUM_TIMEOUT_MILLISECONDS);
				});

				const [validPassword, delayResult] = await Promise.all([
					bcrypt.compare(userPass, existingRows[0].user_password),
					delayPromise
				]);

				if (validPassword) {
					const newToken = jwt.sign({ username, user_id: existingRows[0].id, service_id: id, user_level: existingRows[0].user_level }, jwtKey, {
						algorithm: "HS384",
						expiresIn: jwtExpirySeconds,
					});

					return newToken;
				}
			}
		}
	} catch (err) {
		throw err;
	} finally {
		if (conn) conn.end();
	}

	return null;
}

async function validateJwt(req, postBody) {
	if (!postBody || !postBody.jwt || postBody.jwt === '' || !postBody.password || postBody.password === '') {
		return;
	}

	var url_parts = url.parse(sanitizeUrl(req.url));
	url_parts = url_parts.path;
	url_parts = url_parts.split('/');
	const serviceSegment = url_parts[2];

	if (!serviceSegment || serviceSegment === '' || serviceSegment.length < 6 || serviceSegment.length > 32) {
		return;
	}

	let conn;
	try {
		conn = await pool.getConnection();

		const rows = await conn.query("SELECT id, service_password from tbl_service where service_name = ?", [
			serviceSegment
		]);

		let id;

		if (rows.length > 0) {
			id = rows[0].id;
		}

		if (!id || id < 1) {
			return;
		}

		const validPassword = await bcrypt.compare(postBody.password, rows[0].service_password);
		if (!validPassword) {
			return;
		}

		let payload;
		try {
			payload = jwt.verify(postBody.jwt, jwtKey);
		} catch (jwtErr) {
			if (jwtErr instanceof jwt.JsonWebTokenError) {
				return;
			}

			return;
		}

		if (payload.service_id === id) {
			return true;
		}
	} catch (err) {
		throw err;
	} finally {
		if (conn) conn.end();
	}

	return null;
}

async function refreshJwt(req, postBody) {
	if (!postBody || !postBody.jwt || postBody.jwt === '' || !postBody.password || postBody.password === '') {
		return;
	}

	var url_parts = url.parse(sanitizeUrl(req.url));
	url_parts = url_parts.path;
	url_parts = url_parts.split('/');
	const serviceSegment = url_parts[2];

	if (!serviceSegment || serviceSegment === '' || serviceSegment.length < 6 || serviceSegment.length > 32) {
		return;
	}

	let conn;
	try {
		conn = await pool.getConnection();

		const rows = await conn.query("SELECT id, service_password from tbl_service where service_name = ?", [
			serviceSegment
		]);

		let id;

		if (rows.length > 0) {
			id = rows[0].id;
		}

		if (!id || id < 1) {
			return;
		}

		const validPassword = await bcrypt.compare(postBody.password, rows[0].service_password);
		if (!validPassword) {
			return;
		}

		let payload;
		try {
			payload = jwt.verify(postBody.jwt, jwtKey);
		} catch (jwtErr) {
			if (jwtErr instanceof jwt.JsonWebTokenError) {
				return;
			}

			return;
		}

		if (payload.service_id === id) {
			const existingRows = await conn.query("SELECT user_name, user_level, id from tbl_user where service_id = ? and user_name = ?", [
				id, payload.username
			]);

			if (existingRows.length === 1) {
				const newToken = jwt.sign({ username: existingRows[0].user_name, user_id: existingRows[0].id, service_id: id, user_level: existingRows[0].user_level }, jwtKey, {
					algorithm: "HS384",
					expiresIn: jwtExpirySeconds,
				});

				return newToken;
			}
		}
	} catch (err) {
		throw err;
	} finally {
		if (conn) conn.end();
	}

	return null;
}

async function refreshSuperuserJwt(req, postBody) {
	if (!postBody || !postBody.jwt || postBody.jwt === '' || !postBody.password || postBody.password === '') {
		return;
	}

	var url_parts = url.parse(sanitizeUrl(req.url));
	url_parts = url_parts.path;
	url_parts = url_parts.split('/');
	const serviceSegment = url_parts[2];

	if (!serviceSegment || serviceSegment === '' || serviceSegment.length < 6 || serviceSegment.length > 32) {
		return;
	}

	let conn;
	try {
		conn = await pool.getConnection();

		const rows = await conn.query("SELECT id, service_password from tbl_service where service_name = ?", [
			serviceSegment
		]);

		let id;

		if (rows.length > 0) {
			id = rows[0].id;
		}

		if (!id || id < 1) {
			return;
		}

		const validPassword = await bcrypt.compare(postBody.password, rows[0].service_password);
		if (!validPassword) {
			return;
		}

		let payload;
		try {
			payload = jwt.verify(postBody.jwt, jwtKey);
		} catch (jwtErr) {
			if (jwtErr instanceof jwt.JsonWebTokenError) {
				return;
			}

			return;
		}

		const existingRows = await conn.query("SELECT user_name, id from tbl_superuser where user_name = ?", [
			payload.name
		]);

		if (existingRows.length === 1) {
			const newToken = jwt.sign({ name: existingRows[0].user_name, user_id: existingRows[0].id }, jwtKey, {
				algorithm: "HS384",
				expiresIn: jwtExpirySeconds,
			});

			return newToken;
		}
	} catch (err) {
		throw err;
	} finally {
		if (conn) conn.end();
	}

	return null;
}

async function runStoppedContainers() {
	try {
		if (fs.existsSync('runningports.txt')) {
			fs.unlinkSync('runningports.txt');
		}
	} catch (err) {
		console.error(err);
	}

	console.log('Run stopped containers after removing file');

	cp.exec('./scripts/removestopped.sh', (error, stdout, stderr) => {
		if (error) {
			console.log('Error in removing files');
		}
		if (stderr) {
			console.log('Has stderr output');
			console.log(stderr);
		}

		cp.exec('./scripts/runstopped.sh', async (error, stdout, stderr) => {
			if (error) {
				console.log('Error in removing files');
			}
			if (stderr) {
				console.log('Has stderr output');
				console.log(stderr);
			}

			const runningSet = new Set();

			const allFileContents = fs.readFileSync('runningports.txt', 'utf-8');
			allFileContents.split(/\r?\n/).forEach(line => {
				let port = line.replace(':::', '');
				port = port.replace('->', '');
				port = port.trim();

				if (port !== '') {
					runningSet.add(Number(port));
				}
			});

			let conn;
			try {
				conn = await pool.getConnection();

				const portsToRun = await conn.query("SELECT service_port, service_endpoint, service_name from tbl_endpoint LEFT JOIN tbl_service ON tbl_service.id = service_id");

				if (portsToRun.length > 0) {
					portsToRun.forEach(portRow => {
						const toRun = portRow.service_port;

						if (!runningSet.has(toRun)) {
							cp.exec('./scripts/restartstopped.sh ' + portRow.service_name + portRow.service_endpoint + ':1.0 ' + toRun
								+ ' ' + portRow.service_name, (error, stdout, stderr) => {
									if (error) {
										console.log('Error in removing files');
									}
									if (stderr) {
										console.log('Has stderr output');
										console.log(stderr);
									}

									endpointReadyMap.set(portRow.service_endpoint, true);
								});
						}

						return;
					});
				}
			} catch (err) {
				throw err;
			} finally {
				if (conn) conn.end();
			}
		});
	});
}


async function stopContainer(port) {
	if (!port || port < 3000) {
		return;
	}

	cp.execSync('./scripts/stopcontainer.sh ' + port, (error, stdout, stderr) => {
		if (error) {
			console.log('Error in removing files');
			return;
		}
		if (stderr) {
			console.log('Has stderr output');
			console.log(stderr);
		}

		return;
	});
}

async function executeEndpoint(firstSegment, secondSegment, req, res) {
	if (!firstSegment || !secondSegment) {
		return;
	}

	let conn;
	try {
		conn = await pool.getConnection();

		const rows = await conn.query("SELECT service_name, service_endpoint, service_port from tbl_service LEFT JOIN tbl_endpoint ON service_id = tbl_service.id where service_name = ? and service_endpoint = ?", [
			firstSegment, secondSegment
		]);

		let name, endpoint, port;

		if (rows.length > 0) {
			name = rows[0].service_name;
			endpoint = rows[0].service_endpoint;
			port = rows[0].service_port;
		}

		if (!name || name.length < 6 || name.length > 32 || !endpoint || endpoint.length === 0 || !port || port < 3000) {
			return;
		}

		console.log('Proxy request to: ' + 'https://127.0.0.1:' + port);

		proxy.web(req, res, { target: 'https://127.0.0.1:' + port });

		return true;
	} catch (err) {
		throw err;
	} finally {
		if (conn) conn.end();
	}

	return null;
}

async function isEndpointReady(postBody) {
	if (!postBody || !postBody.endpoint || postBody.endpoint.length === 0) {
		return false;
	}

	return endpointReadyMap.get(postBody.endpoint) === true;
}

async function isServiceReady(postBody) {
	if (!postBody || !postBody.service || postBody.service.length < 6 || postBody.service.length > 32) {
		return false;
	}

	return serviceReadyMap.get(postBody.service) === true;
}

async function loadReadyServices() {
	try {
		fs.unlinkSync('readyservices.txt');
	} catch (err) {
	}

	cp.exec('./scripts/isserviceready.sh', (error, stdout, stderr) => {
		if (error) {
			console.log('Error in removing files');
			return;
		}
		if (stderr) {
			console.log('Has stderr output');
			console.log(stderr);
		}

		const allFileContents = fs.readFileSync('readyservices.txt', 'utf-8');
		allFileContents.split(/\r?\n/).forEach(line => {
			if (line.includes('/usr/disk-images/')) {
				let service = line.substring(line.indexOf('/usr/disk-images/') + 17);

				const closeParenCount = service.split(')').length - 1;

				if (service.endsWith(')') && closeParenCount === 1) {
					serviceReadyMap.set(service.substring(0, service.length - 1), true);
				}
			}
		});

		return;
	});
}

async function loadReadyEndpoints() {
	try {
		if (fs.existsSync('runningports.txt')) {
			fs.unlinkSync('runningports.txt');
		}
	} catch (err) {
	}

	cp.exec('./scripts/runstopped.sh', async (error, stdout, stderr) => {
		if (error) {
			console.log('Error in removing files');
			return;
		}
		if (stderr) {
			console.log('Has stderr output');
			console.log(stderr);
		}

		const runningSet = new Set();

		const allFileContents = fs.readFileSync('runningports.txt', 'utf-8');
		allFileContents.split(/\r?\n/).forEach(line => {
			let port = line.replace(':::', '');
			port = port.replace('->', '');
			port = port.trim();

			if (port !== '') {
				runningSet.add(Number(port));
			}
		});

		let conn;
		try {
			conn = await pool.getConnection();

			const portsToRun = await conn.query("SELECT service_port, service_endpoint, service_name from tbl_endpoint LEFT JOIN tbl_service ON tbl_service.id = service_id");

			portsToRun.forEach(portRow => {
				const toRun = portRow.service_port;

				if (runningSet.has(toRun)) {
					endpointReadyMap.set(portRow.service_endpoint, true);
				}

				return;
			});
		} catch (err) {
			throw err;
		} finally {
			if (conn) conn.end();
		}

		return;
	});
}

const serverOptions = {
	key: fs.readFileSync('keys/key.pem'),
	cert: fs.readFileSync('certificates/cert.pem')
};

const internalSegments = new Set([
	'createservice',
	'createendpoint',
	'removeendpoint',
	'restartendpoint',
	'updateendpoint',
	'adduser',
	'removeuser',
	'updateuser',
	'resetuser',
	'loginuser',
	'refreshjwt',
	'refreshsuperuserjwt',
	'validatejwt',
	'serviceready',
	'endpointready',
	'addsuperuser',
	'loginsuperuser',
]);
Object.freeze(internalSegments);

https.createServer(serverOptions, async function (req, res) {
	const ipAddr = req.connection.remoteAddress;
	rateLimiter.addDateForIp(ipAddr);

	if (rateLimiter.isRateExceededForIp(ipAddr)) {
		var url_parts = url.parse(sanitizeUrl(req.url));
		url_parts = url_parts.path;
		url_parts = url_parts.split('/');

		const firstSegment = url_parts[1];

		if (!internalSegments.has(firstSegment)) {
			const secondSegment = url_parts[2];

			const truthyIfProxied = await executeEndpoint(firstSegment, secondSegment, req, res);

			if (!truthyIfProxied) {
				res.writeHead(500, { 'Content-Type': 'text/plain' });
				res.end('error\n');
			}
		} else {
			res.writeHead(429, { 'Content-Type': 'text/plain' });
			res.end('limit reached\n');
		}
	} else {
		try {
			var url_parts = url.parse(sanitizeUrl(req.url));
			url_parts = url_parts.path;
			url_parts = url_parts.split('/');

			const firstSegment = url_parts[1];

			if (req.method === 'POST' && firstSegment === 'createservice') {
				const bearer = req.headers['authorization'];
				if (!bearer || !bearer.includes('Bearer ')) {
					res.writeHead(401, { 'Content-Type': 'text/plain' });
					res.end('unauthorized\n');
					return;
				}
				const token = bearer.substring(bearer.indexOf(' ') + 1, bearer.length);
				if (!token) {
					res.writeHead(401, { 'Content-Type': 'text/plain' });
					res.end('unauthorized\n');
					return;
				}

				let payload;
				try {
					payload = jwt.verify(token, jwtKey)
				} catch (jwtErr) {
					if (jwtErr instanceof jwt.JsonWebTokenError) {
						res.writeHead(401, { 'Content-Type': 'text/plain' });
						res.end('unauthorized\n');
						return;
					}

					res.writeHead(401, { 'Content-Type': 'text/plain' });
					res.end('unauthorized\n');
					return;
				}

				// service name alphanumeric max of 32 chars, password must be >= minimumPasswordLength and <= 30
				let body = '';
				req.on('data', chunk => {
					body += chunk.toString();
				});

				req.on('end', () => {
					res.writeHead(200, { 'Content-Type': 'text/plain' });
					res.end('queued');

					let bodyJson = null;

					try {
						bodyJson = parseJsonSafely(body, new Set(['', 'NAME', 'PASSWORD']));
					} catch (parseError) {

					}

					if (bodyJson && bodyJson.name && bodyJson.password && bodyJson.name.length >= 6 && bodyJson.password.length >= minimumPasswordLength) {
						const nameOriginal = bodyJson.name;
						const nameFormatted = nameOriginal.replace(/[^a-z0-9]/gi, '');

						if (nameOriginal.length === nameFormatted.length && nameFormatted.length <= 32 && bodyJson.password.length <= 32) {
							const bannedNames = new Set(BANNED_SERVICE_UPPERCASE_NAMES);

							if (bodyJson.name.toUpperCase() !== 'ROOT'
								&& !bannedNames.has(bodyJson.name.toUpperCase())) {
								createService(bodyJson.name, bodyJson.password, payload.user_id);
							}
						}
					}
				});
			} else if (req.method === 'POST' && firstSegment === 'createendpoint') {
				const bearer = req.headers['authorization'];
				if (!bearer || !bearer.includes('Bearer ')) {
					res.writeHead(401, { 'Content-Type': 'text/plain' });
					res.end('unauthorized\n');
					return;
				}
				const token = bearer.substring(bearer.indexOf(' ') + 1, bearer.length);
				if (!token) {
					res.writeHead(401, { 'Content-Type': 'text/plain' });
					res.end('unauthorized\n');
					return;
				}

				let payload;
				try {
					payload = jwt.verify(token, jwtKey)
				} catch (jwtErr) {
					if (jwtErr instanceof jwt.JsonWebTokenError) {
						res.writeHead(401, { 'Content-Type': 'text/plain' });
						res.end('unauthorized\n');
						return;
					}

					res.writeHead(401, { 'Content-Type': 'text/plain' });
					res.end('unauthorized\n');
					return;
				}

				req.url = sanitizeUrl(req.url).replace('createendpoint/', '');
				const port = await createEndpoint(req, res);

				if (port) {
					uploadMedia(req, res, true);
				} else {
					res.writeHead(500, { 'Content-Type': 'text/plain' });
					res.end('error\n');
				}
			} else if (req.method === 'POST' && firstSegment === 'removeendpoint') {
				const bearer = req.headers['authorization'];
				if (!bearer || !bearer.includes('Bearer ')) {
					res.writeHead(401, { 'Content-Type': 'text/plain' });
					res.end('unauthorized\n');
					return;
				}
				const token = bearer.substring(bearer.indexOf(' ') + 1, bearer.length);
				if (!token) {
					res.writeHead(401, { 'Content-Type': 'text/plain' });
					res.end('unauthorized\n');
					return;
				}

				let payload;
				try {
					payload = jwt.verify(token, jwtKey)
				} catch (jwtErr) {
					if (jwtErr instanceof jwt.JsonWebTokenError) {
						res.writeHead(401, { 'Content-Type': 'text/plain' });
						res.end('unauthorized\n');
						return;
					}

					res.writeHead(401, { 'Content-Type': 'text/plain' });
					res.end('unauthorized\n');
					return;
				}

				let body = '';
				req.on('data', chunk => {
					body += chunk.toString();
				});
				req.on('end', async () => {
					let bodyJson = null;

					try {
						bodyJson = parseJsonSafely(body, new Set(['', 'PASSWORD']));
					} catch (parseError) {

					}

					req.url = sanitizeUrl(req.url).replace('removeendpoint/', '');
					await removeEndpoint(req, res, bodyJson);

					res.writeHead(200, { 'Content-Type': 'text/plain' });
					res.end('queued\n');
				});
			} else if (req.method === 'POST' && firstSegment === 'restartendpoint') {
				const bearer = req.headers['authorization'];
				if (!bearer || !bearer.includes('Bearer ')) {
					res.writeHead(401, { 'Content-Type': 'text/plain' });
					res.end('unauthorized\n');
					return;
				}
				const token = bearer.substring(bearer.indexOf(' ') + 1, bearer.length);
				if (!token) {
					res.writeHead(401, { 'Content-Type': 'text/plain' });
					res.end('unauthorized\n');
					return;
				}

				let payload;
				try {
					payload = jwt.verify(token, jwtKey)
				} catch (jwtErr) {
					if (jwtErr instanceof jwt.JsonWebTokenError) {
						res.writeHead(401, { 'Content-Type': 'text/plain' });
						res.end('unauthorized\n');
						return;
					}

					res.writeHead(401, { 'Content-Type': 'text/plain' });
					res.end('unauthorized\n');
					return;
				}

				let body = '';
				req.on('data', chunk => {
					body += chunk.toString();
				});
				req.on('end', async () => {
					let bodyJson = null;

					try {
						bodyJson = parseJsonSafely(body, new Set(['', 'PASSWORD']));
					} catch (parseError) {

					}

					req.url = sanitizeUrl(req.url).replace('restartendpoint/', '');
					await restartEndpoint(req, res, bodyJson);

					res.writeHead(200, { 'Content-Type': 'text/plain' });
					res.end('queued\n');
				});
			} else if (req.method === 'POST' && firstSegment === 'updateendpoint') {
				const bearer = req.headers['authorization'];
				if (!bearer || !bearer.includes('Bearer ')) {
					res.writeHead(401, { 'Content-Type': 'text/plain' });
					res.end('unauthorized\n');
					return;
				}
				const token = bearer.substring(bearer.indexOf(' ') + 1, bearer.length);
				if (!token) {
					res.writeHead(401, { 'Content-Type': 'text/plain' });
					res.end('unauthorized\n');
					return;
				}

				let payload;
				try {
					payload = jwt.verify(token, jwtKey)
				} catch (jwtErr) {
					if (jwtErr instanceof jwt.JsonWebTokenError) {
						res.writeHead(401, { 'Content-Type': 'text/plain' });
						res.end('unauthorized\n');
						return;
					}

					res.writeHead(401, { 'Content-Type': 'text/plain' });
					res.end('unauthorized\n');
					return;
				}

				req.url = sanitizeUrl(req.url).replace('updateendpoint/', '');
				uploadMedia(req, res);

				res.writeHead(200, { 'Content-Type': 'text/plain' });
				res.end('queued\n');
			} else if (req.method === 'POST' && firstSegment === 'adduser') {
				// service name alphanumeric max of 32 chars, password must be >= minimumPasswordLength and <= 30
				let body = '';
				req.on('data', chunk => {
					body += chunk.toString();
				});
				req.on('end', async () => {
					let bodyJson = null;

					try {
						bodyJson = parseJsonSafely(body, new Set(['', 'USERPASSWORD', 'USERLEVEL', 'USERNAME', 'PASSWORD']));
					} catch (parseError) {

					}

					const result = await addUser(req, bodyJson);

					if (result === true) {
						res.writeHead(200, { 'Content-Type': 'text/plain' });
						res.end('added\n');
					} else {
						res.writeHead(500, { 'Content-Type': 'text/plain' });
						res.end('error\n');
					}
				});
			} else if (req.method === 'POST' && firstSegment === 'removeuser') {
				// service name alphanumeric max of 32 chars, password must be >= minimumPasswordLength and <= 30
				let body = '';
				req.on('data', chunk => {
					body += chunk.toString();
				});
				req.on('end', async () => {
					let bodyJson = null;

					try {
						bodyJson = parseJsonSafely(body, new Set(['', 'USERNAME', 'PASSWORD']));
					} catch (parseError) {

					}

					await removeUser(req, bodyJson);

					res.writeHead(200, { 'Content-Type': 'text/plain' });
					res.end('removed\n');
				});
			} else if (req.method === 'POST' && firstSegment === 'updateuser') {
				// service name alphanumeric max of 32 chars, password must be >= minimumPasswordLength and <= 30
				let body = '';
				req.on('data', chunk => {
					body += chunk.toString();
				});
				req.on('end', async () => {
					let bodyJson = null;

					try {
						bodyJson = parseJsonSafely(body, new Set(['', 'USERPASSWORD', 'NEWPASSWORD', 'USERNAME', 'PASSWORD']));
					} catch (parseError) {

					}

					const result = await updateUser(req, bodyJson);

					if (result === true) {
						res.writeHead(200, { 'Content-Type': 'text/plain' });
						res.end('updated\n');
					} else {
						res.writeHead(500, { 'Content-Type': 'text/plain' });
						res.end('error\n');
					}
				});
			} else if (req.method === 'POST' && firstSegment === 'resetuser') {
				// service name alphanumeric max of 32 chars, password must be >= minimumPasswordLength and <= 30
				let body = '';
				req.on('data', chunk => {
					body += chunk.toString();
				});
				req.on('end', async () => {
					let bodyJson = null;

					try {
						bodyJson = parseJsonSafely(body, new Set(['', 'NEWPASSWORD', 'USERNAME', 'PASSWORD']));
					} catch (parseError) {

					}

					const result = await resetUser(req, bodyJson);

					if (result === true) {
						res.writeHead(200, { 'Content-Type': 'text/plain' });
						res.end('reset\n');
					} else {
						res.writeHead(500, { 'Content-Type': 'text/plain' });
						res.end('error\n');
					}
				});
			} else if (req.method === 'POST' && firstSegment === 'loginuser') {
				// service name alphanumeric max of 32 chars, password must be >= minimumPasswordLength and <= 30
				let body = '';
				req.on('data', chunk => {
					body += chunk.toString();
				});
				req.on('end', async () => {
					let bodyJson = null;

					try {
						bodyJson = parseJsonSafely(body, new Set(['', 'USERPASSWORD', 'USERNAME', 'PASSWORD']));
					} catch (parseError) {

					}

					const token = await loginUser(req, bodyJson);

					res.writeHead(200, { 'Content-Type': 'text/plain' });
					res.end(token);
				});
			} else if (req.method === 'POST' && firstSegment === 'refreshjwt') {
				// service name alphanumeric max of 32 chars, password must be >= minimumPasswordLength and <= 30
				let body = '';
				req.on('data', chunk => {
					body += chunk.toString();
				});
				req.on('end', async () => {
					let bodyJson = null;

					try {
						bodyJson = parseJsonSafely(body, new Set(['', 'JWT', 'PASSWORD']));
					} catch (parseError) {

					}

					const token = await refreshJwt(req, bodyJson);

					if (token !== null && token !== undefined) {
						res.writeHead(200, { 'Content-Type': 'text/plain' });
						res.end(token);
					} else {
						res.writeHead(401, { 'Content-Type': 'text/plain' });
						res.end('Invalid');
					}
				});
			} else if (req.method === 'POST' && firstSegment === 'refreshsuperuserjwt') {
				// service name alphanumeric max of 32 chars, password must be >= minimumPasswordLength and <= 30
				let body = '';
				req.on('data', chunk => {
					body += chunk.toString();
				});
				req.on('end', async () => {
					let bodyJson = null;

					try {
						bodyJson = parseJsonSafely(body, new Set(['', 'JWT', 'PASSWORD']));
					} catch (parseError) {

					}

					const token = await refreshSuperuserJwt(req, bodyJson);

					if (token !== null && token !== undefined) {
						res.writeHead(200, { 'Content-Type': 'text/plain' });
						res.end(token);
					} else {
						res.writeHead(401, { 'Content-Type': 'text/plain' });
						res.end('Invalid');
					}
				});
			} else if (req.method === 'POST' && firstSegment === 'validatejwt') {
				// service name alphanumeric max of 32 chars, password must be >= minimumPasswordLength and <= 30
				let body = '';
				req.on('data', chunk => {
					body += chunk.toString();
				});
				req.on('end', async () => {
					let bodyJson = null;

					try {
						bodyJson = parseJsonSafely(body, new Set(['', 'JWT', 'PASSWORD']));
					} catch (parseError) {

					}

					const success = await validateJwt(req, bodyJson);

					if (success) {
						res.writeHead(200, { 'Content-Type': 'text/plain' });
						res.end('Valid');
					} else {
						res.writeHead(401, { 'Content-Type': 'text/plain' });
						res.end('Invalid');
					}
				});
			} else if (req.method === 'POST' && firstSegment === 'serviceready') {
				// service name alphanumeric max of 32 chars, password must be >= minimumPasswordLength and <= 30
				let body = '';
				req.on('data', chunk => {
					body += chunk.toString();
				});
				req.on('end', async () => {
					let bodyJson = null;

					try {
						bodyJson = parseJsonSafely(body, new Set(['', 'SERVICE']));
					} catch (parseError) {

					}

					const success = await isServiceReady(bodyJson);

					if (success) {
						res.writeHead(200, { 'Content-Type': 'text/plain' });
						res.end('Ready');
					} else {
						res.writeHead(200, { 'Content-Type': 'text/plain' });
						res.end('Not ready');
					}
				});
			} else if (req.method === 'POST' && firstSegment === 'endpointready') {
				// service name alphanumeric max of 32 chars, password must be >= minimumPasswordLength and <= 30
				let body = '';
				req.on('data', chunk => {
					body += chunk.toString();
				});
				req.on('end', async () => {
					let bodyJson = null;

					try {
						bodyJson = parseJsonSafely(body, new Set(['', 'ENDPOINT']));
					} catch (parseError) {

					}

					const success = await isEndpointReady(bodyJson);

					if (success) {
						res.writeHead(200, { 'Content-Type': 'text/plain' });
						res.end('Ready');
					} else {
						res.writeHead(200, { 'Content-Type': 'text/plain' });
						res.end('Not ready');
					}
				});
			} else if (req.method === 'POST' && firstSegment === 'addsuperuser') {
				// service name alphanumeric max of 32 chars, password must be >= minimumPasswordLength and <= 30
				let body = '';
				req.on('data', chunk => {
					body += chunk.toString();
				});
				req.on('end', async () => {
					let bodyJson = null;

					try {
						bodyJson = parseJsonSafely(body, new Set(['', 'USERNAME', 'PASSWORD']));
					} catch (parseError) {

					}

					const result = await addSuperuser(req, bodyJson);

					if (result === true) {
						res.writeHead(200, { 'Content-Type': 'text/plain' });
						res.end('added\n');
					} else {
						res.writeHead(500, { 'Content-Type': 'text/plain' });
						res.end('error\n');
					}
				});
			} else if (req.method === 'POST' && firstSegment === 'loginsuperuser') {
				// service name alphanumeric max of 32 chars, password must be >= minimumPasswordLength and <= 30
				let body = '';
				req.on('data', chunk => {
					body += chunk.toString();
				});
				req.on('end', async () => {
					let bodyJson = null;

					try {
						bodyJson = parseJsonSafely(body, new Set(['', 'USERNAME', 'PASSWORD']));
					} catch (parseError) {

					}

					const token = await loginSuperuser(req, bodyJson);

					res.writeHead(200, { 'Content-Type': 'text/plain' });
					res.end(token);
				});
			} else {
				const secondSegment = url_parts[2];

				const truthyIfProxied = await executeEndpoint(firstSegment, secondSegment, req, res);

				if (!truthyIfProxied) {
					res.writeHead(500, { 'Content-Type': 'text/plain' });
					res.end('error\n');
				}
			}
		} catch (fallbackError) {
			res.writeHead(500, { 'Content-Type': 'text/plain' });
			res.end('error\n');
		}
	}
}).listen(443, '0.0.0.0');

console.log('Server running.');

loadReadyServices();
loadReadyEndpoints();
runStoppedContainers();
