DROP DATABASE IF EXISTS TRAVELERS;
CREATE DATABASE TRAVELERS;
USE TRAVELERS;

CREATE TABLE users (
    user_id binary(16) NOT NULL,
    userName varchar(80) NOT NULL,
    fullName varchar(80) NOT NULL,
    hidden tinyint(1) DEFAULT '0',
    email varchar(150) NOT NULL,
    pass varchar(150) NOT NULL,
    phone varchar(20) DEFAULT NULL,
    DNI varchar(20) NOT NULL,
    perfil_image varchar(500) DEFAULT 'default.png',
    created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id),
    UNIQUE KEY email (email),
    UNIQUE KEY DNI (DNI),
    UNIQUE KEY phone (phone),
    KEY idx_users_id (user_id)
);

CREATE TABLE cities (
    city_id int NOT NULL AUTO_INCREMENT,
    city_name varchar(200) NOT NULL,
    province varchar(100) NOT NULL,
    climate varchar(15) DEFAULT NULL,
    descripcion text,
    fotos text,
    PRIMARY KEY (city_id),
    UNIQUE KEY city_name (city_name),
    KEY idx_cities_city_id (city_id)
);

CREATE TABLE attractions (
    attraction_id int NOT NULL AUTO_INCREMENT,
    name varchar(50) NOT NULL,
    PRIMARY KEY (attraction_id),
    UNIQUE KEY name (name)
);

CREATE TABLE characteristics (
    characteristic_id int NOT NULL AUTO_INCREMENT,
    name varchar(50) NOT NULL,
    PRIMARY KEY (characteristic_id),
    UNIQUE KEY name (name),
    KEY idx_characteristic_id (characteristic_id)
);

CREATE TABLE refresh_tokens (
    id binary(16) NOT NULL,
    token varchar(64) NOT NULL,
    expires_at datetime NOT NULL,
    revoked tinyint(1) DEFAULT '0',
    created_at datetime DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY token (token)
);

CREATE TABLE chat (
    chat_id int NOT NULL AUTO_INCREMENT,
    user1_id binary(16) DEFAULT NULL,
    user2_id binary(16) DEFAULT NULL,
    PRIMARY KEY (chat_id),
    KEY user1_id (user1_id),
    KEY user2_id (user2_id),
    CONSTRAINT chat_ibfk_1 FOREIGN KEY (user1_id) REFERENCES users (user_id),
    CONSTRAINT chat_ibfk_2 FOREIGN KEY (user2_id) REFERENCES users (user_id)
);

CREATE TABLE messages (
    message_id int NOT NULL AUTO_INCREMENT,
    chat_id int NOT NULL,
    content varchar(500) NOT NULL,
    created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (message_id),
    KEY chat_id (chat_id),
    CONSTRAINT messages_ibfk_1 FOREIGN KEY (chat_id) REFERENCES chat (chat_id)
);

CREATE TABLE notify (
    notify_id int NOT NULL AUTO_INCREMENT,
    user_id binary(16) NOT NULL,
    tipo enum('reservation','message','promo') NOT NULL,
    content varchar(500) NOT NULL,
    message_id int DEFAULT NULL,
    is_read tinyint(1) DEFAULT '0',
    created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (notify_id),
    KEY user_id (user_id),
    KEY message_id (message_id),
    CONSTRAINT notify_ibfk_1 FOREIGN KEY (user_id) REFERENCES users (user_id),
    CONSTRAINT notify_ibfk_2 FOREIGN KEY (message_id) REFERENCES messages (message_id)
);

CREATE TABLE user_audit_logs (
    audit_id int NOT NULL AUTO_INCREMENT,
    user_id binary(16) NOT NULL,
    actionn enum('delete','update') NOT NULL,
    old_data varchar(500) NOT NULL,
    action_date timestamp NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (audit_id),
    KEY user_id (user_id),
    CONSTRAINT user_audit_logs_ibfk_1 FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
);

CREATE TABLE activity_logs (
    log_id int NOT NULL AUTO_INCREMENT,
    user_id binary(16) DEFAULT NULL,
    ip_address varchar(45) DEFAULT NULL,
    action varchar(100) DEFAULT NULL,
    details text,
    created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (log_id),
    KEY user_id (user_id),
    CONSTRAINT activity_logs_ibfk_1 FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
);

CREATE TABLE city_attractions (
    city_id int NOT NULL,
    attraction_id int NOT NULL,
    PRIMARY KEY (city_id,attraction_id),
    KEY attraction_id (attraction_id),
    CONSTRAINT city_attractions_ibfk_1 FOREIGN KEY (city_id) REFERENCES cities (city_id) ON DELETE CASCADE,
    CONSTRAINT city_attractions_ibfk_2 FOREIGN KEY (attraction_id) REFERENCES attractions (attraction_id) ON DELETE CASCADE
);

CREATE TABLE propieties (
    propiety_id int NOT NULL AUTO_INCREMENT,
    city_id int NOT NULL,
    user_id binary(16) NOT NULL,
    latitude decimal(10,8) DEFAULT NULL,
    longitude decimal(11,8) DEFAULT NULL,
    imgs varchar(500) DEFAULT NULL,
    characteristics text,
    hidden tinyint(1) DEFAULT '1',
    price decimal(10,2) DEFAULT NULL,
    ranking decimal(5,2) DEFAULT '2.00',
    created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (propiety_id),
    KEY idx_propieties_propiety_id (propiety_id),
    KEY idx_propieties_city (city_id),
    KEY idx_propieties_user_id (user_id),
    CONSTRAINT propieties_ibfk_1 FOREIGN KEY (city_id) REFERENCES cities (city_id) ON DELETE CASCADE,
    CONSTRAINT propieties_ibfk_2 FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
);

CREATE TABLE propiety_characteristics (
    propiety_id int NOT NULL,
    characteristic_id int NOT NULL,
    PRIMARY KEY (propiety_id,characteristic_id),
    KEY idx_propiety_characteristicsP (propiety_id),
    KEY idx_propiety_characteristicsC (characteristic_id),
    CONSTRAINT propiety_characteristics_ibfk_1 FOREIGN KEY (propiety_id) REFERENCES propieties (propiety_id) ON DELETE CASCADE,
    CONSTRAINT propiety_characteristics_ibfk_2 FOREIGN KEY (characteristic_id) REFERENCES characteristics (characteristic_id) ON DELETE CASCADE
);

CREATE TABLE favorites (
    propiety_id int NOT NULL,
    user_id binary(16) NOT NULL,
    PRIMARY KEY (propiety_id,user_id),
    KEY user_id (user_id),
    CONSTRAINT favorites_ibfk_1 FOREIGN KEY (propiety_id) REFERENCES propieties (propiety_id) ON DELETE CASCADE,
    CONSTRAINT favorites_ibfk_2 FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
);

CREATE TABLE boosts (
    user_id binary(16) NOT NULL,
    propiety_id int NOT NULL,
    start_date datetime DEFAULT CURRENT_TIMESTAMP,
    expires_at datetime GENERATED ALWAYS AS ((start_date + interval 30 day)) STORED,
    boost_factor decimal(2,1) DEFAULT '1.0',
    activo tinyint(1) DEFAULT '1',
    PRIMARY KEY (user_id,propiety_id),
    KEY propiety_id (propiety_id),
    CONSTRAINT boosts_ibfk_1 FOREIGN KEY (propiety_id) REFERENCES propieties (propiety_id) ON DELETE CASCADE,
    CONSTRAINT boosts_ibfk_2 FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
);

CREATE TABLE reviews (
    review_id int NOT NULL AUTO_INCREMENT,
    user_id binary(16) NOT NULL,
    propiety_id int NOT NULL,
    rating enum('1','2','3','4','5') NOT NULL,
    comment varchar(500) NOT NULL,
    created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (review_id),
    KEY user_id (user_id),
    KEY propiety_id (propiety_id),
    CONSTRAINT reviews_ibfk_1 FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE,
    CONSTRAINT reviews_ibfk_2 FOREIGN KEY (propiety_id) REFERENCES propieties (propiety_id) ON DELETE CASCADE
);

CREATE TABLE reservations (
    reservation_id int NOT NULL AUTO_INCREMENT,
    user_id binary(16) NOT NULL,
    propiety_id int NOT NULL,
    check_in date NOT NULL,
    check_out date NOT NULL,
    total_price decimal(10,2) NOT NULL,
    details varchar(500) DEFAULT NULL,
    total_days int GENERATED ALWAYS AS ((to_days(check_out) - to_days(check_in))) STORED,
    state enum('pending','confirmed','cancelled') DEFAULT 'pending',
    created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (reservation_id),
    KEY idx_reservations_reservation_id (reservation_id),
    KEY idx_reservations_user (user_id),
    KEY idx_reservations_property (propiety_id),
    CONSTRAINT reservations_ibfk_1 FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE,
    CONSTRAINT reservations_ibfk_2 FOREIGN KEY (propiety_id) REFERENCES propieties (propiety_id) ON DELETE CASCADE
);

CREATE TABLE reclaims (
    reclaim_id int NOT NULL AUTO_INCREMENT,
    reservation_id int DEFAULT NULL,
    message text NOT NULL,
    user_id binary(16) NOT NULL,
    propiety_id int DEFAULT NULL,
    imgs text,
    PRIMARY KEY (reclaim_id),
    KEY user_id (user_id),
    KEY propiety_id (propiety_id),
    CONSTRAINT reclaims_ibfk_1 FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE,
    CONSTRAINT reclaims_ibfk_2 FOREIGN KEY (propiety_id) REFERENCES propieties (propiety_id) ON DELETE CASCADE
);

CREATE TABLE propietie_audit_logs (
    audit_id int NOT NULL AUTO_INCREMENT,
    propiety_id int NOT NULL,
    old_data text,
    updated_at datetime DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (audit_id)
);

CREATE TABLE imagenes (
    id bigint NOT NULL AUTO_INCREMENT,
    propiety_id int NOT NULL,
    url varchar(2048) NOT NULL,
    tipo varchar(50) DEFAULT NULL,
    tamaño int DEFAULT NULL,
    orden int DEFAULT '1',
    created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY propiety_id (propiety_id),
    CONSTRAINT imagenes_ibfk_1 FOREIGN KEY (propiety_id) REFERENCES propieties (propiety_id) ON DELETE CASCADE
);


