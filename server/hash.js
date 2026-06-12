// Утилита генерации bcrypt-хеша пароля.
// Использование:  node hash.js "мой-пароль"
// Полученный хеш вставьте в users.json как "passwordHash".

import bcrypt from 'bcryptjs';

const password = process.argv[2];
if (!password) {
  console.error('Использование: node hash.js "пароль"');
  process.exit(1);
}

console.log(bcrypt.hashSync(password, 12));
