var https = require('https');
var url = require('url');
var fs = require('fs');
var cp = require('child_process');
const path = require('path');

const mariadb = require('mariadb');
const pool = mariadb.createPool({
	host: 'localhost',
	user: 'root',
	password: 'password',
	connectionLimit: 10,
	database: 'cleanbase'
});

async function activateSuperuser(username) {
	let conn;
	try {
		conn = await pool.getConnection();
		console.log("got connection");

		const res = await conn.query("SELECT user_name from tbl_superuser WHERE user_name = ?", [
			username
		]);

		if (res.length > 0) {
			console.log('activating...');

			const res = await conn.query("UPDATE tbl_superuser SET is_active = 1 WHERE user_name = ?", [
				username
			]);
		} else {
			console.log('no user by name: ' + username);
		}
	} catch (err) {
		throw err;
	} finally {
		if (conn) conn.end();
	}
}

async function run() {
	await activateSuperuser(process.argv[2]);
	console.log('DONE');
	process.exit(1);
}

run();
