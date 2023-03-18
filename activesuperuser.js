var https = require('https');
var url = require('url');
var fs = require('fs');
var cp = require('child_process');
const path = require('path');

const mariadb = require('mariadb');
const { DATABASE_PASSWORD, DATABASE_HOST, DATABASE_USER, DATABASE_CONNECTION_LIMIT } = require('./constants');
const pool = mariadb.createPool({
	host: DATABASE_HOST,
	user: DATABASE_USER,
	password: DATABASE_PASSWORD,
	connectionLimit: DATABASE_CONNECTION_LIMIT,
	database: 'cleanbase'
});

async function activateSuperuser(username) {
	let conn;
	try {
		conn = await pool.getConnection();

		const res = await conn.query("SELECT user_name from tbl_superuser WHERE user_name = ?", [
			username
		]);

		if (res.length > 0) {
			console.log('Activating...');

			const res = await conn.query("UPDATE tbl_superuser SET is_active = 1 WHERE user_name = ?", [
				username
			]);
		} else {
			console.log('No user by name: ' + username);
		}
	} catch (err) {
		throw err;
	} finally {
		if (conn) conn.end();
	}
}

async function run() {
	await activateSuperuser(process.argv[2]);
	console.log('Done');
	process.exit(1);
}

run();
