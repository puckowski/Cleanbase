CREATE DATABASE cleanbase CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE cleanbase;

create table tbl_service (
   id INT NOT NULL AUTO_INCREMENT,
   service_name VARCHAR(500) NOT NULL,
   service_password VARCHAR(128) NOT NULL,
   superuser_id INT NOT NULL,
   PRIMARY KEY ( id )
);

create table tbl_user (
   id INT NOT NULL AUTO_INCREMENT,
   user_name VARCHAR(500) NOT NULL,
   user_password VARCHAR(128) NOT NULL,
   service_id INT NOT NULL,
   PRIMARY KEY ( id )
);

create table tbl_endpoint (
   id INT NOT NULL AUTO_INCREMENT,
   service_id INT NOT NULL,
   service_port INT NOT NULL,
   service_endpoint VARCHAR(500) NOT NULL,
   build_path VARCHAR(4096) NOT NULL,
   PRIMARY KEY ( id )
);

create table tbl_superuser (
	id INT NOT NULL AUTO_INCREMENT,
	user_name VARCHAR(500) NOT NULL,
    user_password VARCHAR(128) NOT NULL,
    is_active TINYINT NOT NULL,
    PRIMARY KEY ( id )
);

