# Cleanbase

Cleanbase is system to register and run up to 127 services on a single Ubuntu 20.04 host.

Not for any production use. Hacked together over a few weekends.

## Limitations

Services must be Node.js services archived in a .zip archive no greater than 50 megabytes in size and which consumes no more than 128 megabytes of memory.
There is 100 megabytes of storage, persistant across service builds, available under /virtualdisk, to each service.
Services can write up to 50MB of temporary data. Services are based on Alpine Linux.
Endpoints must respond within 1000 milliseconds. This is to prevent one service from utilizing too many resources.

## Requirements

At a minimum, have: 
- Disk space: 40 GB
- Memory: 20 GB
- Compute: 2 vCPU
- Filesystem is formatted as xfs or a second xfs disk is added following the steps in setupcleanbase_manual.md

## Installation

In maria-init/mariadb-init-2.txt and maria-init/mariadb-init-3.txt replace ```password``` with your desired database password.
Replace ```DATABASE_PASSWORD``` with your specified database password in:
- constants.js

On an Ubuntu 20.04 host, in a terminal, run the following command:

```
./setupcleanbase.sh
```

For added security, add sudoer account names, uppercase, to the following array in ```constants.js```:

```const BANNED_SERVICE_UPPERCASE_NAMES = ['ROOT'];```

If using a MariaDB database not on localhost, update ```localhost``` with the host for your database in ```scripts/rebuildall.sh```.

```
while ! mysqladmin ping -h"localhost" --silent; do
    sleep 1
done
```

## Running

In a terminal, run the following command:

```
sudo node server.js
```

## On host reboot

Reboot cron job should automatically restart services. If reboot cron job fails, in a terminal, run the following command:

```
./scripts/rebuildall.sh
```

## Backups

Backups should automatically be created in /homebackups and /uploadbackups.

Directories under /home can be restored from a .tar.gz backup in /homebackups

Builds under /uploads can be restored from a .tar.gz backup in /uploadbackups

## Security

Database password should be reset and updated in the following:
- rebuildallandrun.js
- server.js
- activesuperuser.js
- standalonerunstopped.js
- rebuildservices.js

## Certificate

You will want to replace cert.pem and key.pem with your own valid certificate.

### JWT Key

You will want to replace the JWT key in server.js.

```
const jwtKey = "1234567890";
```

## Endpoints

https://localhost/createservice
POST body:
{
	"name": "servicename",
	"password": "123456789101112"
}
Requires Authorization Bearer header (superuser JWT).
Service name must be alphanumeric and have a maximum of 32 characters. Service name must be at least 6 characters. Password must be at least 12 characters and less than 33 characters.

https://localhost/createendpoint/{SERVICE_NAME}/{ENDPOINT_NAME}
Multipart form with one part where the name is the service password and the value is a 50 megabyte .zip archive of your Node.js service.
Requires Authorization Bearer header (superuser JWT). Zip archive must contain a server.js file which sets up the service on port 80.
An example zip archive can be located in the root of the project, named build.zip.

https://localhost/updateendpoint/{SERVICE_NAME}/{ENDPOINT_NAME}
Multipart form with one part where the name is the service password and the value is a 50 megabyte .zip archive of your Node.js service.
Requires Authorization Bearer header (superuser JWT).

https://localhost/serviceready
POST body:
{
	"service": "servicename"
}

https://localhost/endpointready
POST body:
{
	"endpoint": "endpointname"
}

https://localhost/addsuperuser
POST body:
{
	"password": "123456789101112",
	"username": "abcdefg"
}

Note: added superusers which can register services and endpoints are inactive by default. The must be activated by running the following in a terminal:

```
sudo node activesuperuser.js {SUPERUSER_NAME}
```

https://localhost/loginsuperuser
POST body:
{
	"password": "123456789101112",
	"username": "abcdefg"
}

https://localhost/refreshsuperuserjwt/{SERVICE_NAME}
POST body:
{
	"password": "123456789101112",
	"jwt": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6ImFiY2RlZmciLCJ1c2VyX2lkIjoxLCJzZXJ2aWNlX2lkIjoxLCJpYXQiOjE2NTA0OTA4MjgsImV4cCI6MTY1MDQ5MTcyOH0.GUpK78Im8UIO9I6mAvHB2FZoTc0a0HKqQTjQcOXRnS"
}

https://localhost/removeendpoint/{SERVICE_NAME}/{ENDPOINT_NAME}
POST body:
{
	"password": "123456789101112"
}
Requires Authorization Bearer header (superuser JWT).

https://localhost/restartendpoint/{SERVICE_NAME}/{ENDPOINT_NAME}
{
	"password": "123456789101112"
}
Requires Authorization Bearer header (superuser JWT).

## Accessing registered endpoints

https://localhost/{SERVICE_NAME}/{ENDPOINT_NAME}

May add URL segments as needed. May be POST or GET, etc. Requests will be proxied to your service.

## Endpoint available to registered services

Services have a few endpoints available for convenience.

https://172.17.0.1:443/validatejwt/{SERVICE_NAME}
POST body:
{
	"password": "123456789101112",
	"jwt": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6ImFiY2RlZmciLCJ1c2VyX2lkIjoxLCJzZXJ2aWNlX2lkIjoxLCJpYXQiOjE2NTA0OTA4MjgsImV4cCI6MTY1MDQ5MTcyOH0.GUpK78Im8UIO9I6mAvHB2FZoTc0a0HKqQTjQcOXRnS"
}

https://172.17.0.1:443/refreshjwt/{SERVICE_NAME}
POST body:
{
	"password": "123456789101112",
	"jwt": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6ImFiY2RlZmciLCJ1c2VyX2lkIjoxLCJzZXJ2aWNlX2lkIjoxLCJpYXQiOjE2NTA0OTA4MjgsImV4cCI6MTY1MDQ5MTcyOH0.GUpK78Im8UIO9I6mAvHB2FZoTc0a0HKqQTjQcOXRnS"
}

https://172.17.0.1:443/adduser/{SERVICE_NAME}
POST body:
{
	"password": "123456789101112",
	"username": "abcdefg",
	"userPassword": "123456789101112",
	"userLevel": 5
}
Username must be alphanumeric and have a maximum of 32 characters at be at least 6 characters. Password must be at least 12 characters and less than 33 characters. User level must be at least 1 and no more than 10.

https://172.17.0.1:443/loginuser/{SERVICE_NAME}
POST body:
{
	"password": "123456789101112",
	"username": "abcdefg",
	"userPassword": "123456789101112"
}
Returns JWT with payload containing:
```
"username": <>,
"user_id": <>,
"service_id": <>,
"user_level": <>
```

https://172.17.0.1:443/removeuser/{SERVICE_NAME}
POST body:
{
	"password": "123456789101112",
	"username": "abcdefg"
}
Username must be alphanumeric and have a maximum of 32 characters at be at least 6 characters.

https://172.17.0.1:443/updateuser/{SERVICE_NAME}
POST body:
{
	"password": "123456789101112",
	"username": "abcdefg",
	"userPassword": "123456789101112",
	"newPassword": "789012"
}
Updates user password. Username must be alphanumeric and have a maximum of 32 characters at be at least 6 characters. Passwords must be at least 12 characters and less than 33 characters.

https://172.17.0.1:443/resetuser/{SERVICE_NAME}
POST body:
{
	"password": "123456789101112",
	"username": "abcdefg",
	"newPassword": "789012345678910"
}
Updates user password forcibly. Username must be alphanumeric and have a maximum of 32 characters at be at least 6 characters. Password must be at least 12 characters and less than 33 characters.

## Version 2.3

- Requests are limited to 2 megabytes in size by default.
  
## Version 2.2

- Add additional guard for timing attacks which is configurable in constants.js.

## Version 2.1

- Add constants for database connection configuration.
- Increase the maximum number of connections by default.

## Version 2.0

- Update how account passwords are set.
- Add constant for banned usernames for added security.
- Sanitize URL paths for added safety.

## Version 1.9

- Do not rate limit endpoints.

## Version 1.8

- Guard against JSON.parse injection attacks.

## Version 1.7

- Update JWT signing algorithm to be stronger.
- Strengthen more endpoints by requirements superuser service password.
- Update responses from endpoints to be more accurate.
- Make minimum password length configurable by constant (default 12).

## Version 1.6

- Add handling for invalid JSON.
- Strengthen password requirements.
- Add new refresh JWT function for endpoints.
- Add new refresh superuser JWT function.
- Bug fix JWT verification function.

## Version 1.5

- Add folder structure.
- Enhance restart endpoint function.
- Add IP address rate limiting.
- Add constants for IP address rate limiting.

## Version 1.4

- Add guard for zip bombs limiting service zip archives to 250 megabytes uncompressed.
- Add example build which queries host system.
- Adjust HTTP status code responses.
- Adjust console logging.
- Remove old code comments.
- Add constant for JWT secret.

## Version 1.3

- Update dependencies.
- Clean up basic responses.
- Clean up console logging.
- Add constants for JWT expiry, Formidable max upload size, and endpoint timeout.

## Version 1.2

- Create constants file for database credentials.
- Limit endpoints to 1000 milliseconds synchronous execution.
- Add worker for endpoint restart.
- Add worker for remove endpoint and fix bug with remove endpoint.
- Add user level for users as a basic authorization system and update initial DDLs.
- Add worker for new endpoints.

## Version 1.1

- Add https://172.17.0.1:443/removeuser/{SERVICE_NAME}
- Add https://172.17.0.1:443/updateuser/{SERVICE_NAME}
- Add https://172.17.0.1:443/resetuser/{SERVICE_NAME}
- Add filesystem quotas per user.

## Dependecy version support

- Node 16.19.1
- npm 8.19.3
- MariaDB 10.3.38
- quota 4.05
- Docker 23.0.1
