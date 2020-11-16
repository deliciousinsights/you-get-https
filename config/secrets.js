const { createCipher } = require('aes256')

const CONFIG_SECRETS_KEY = 'K2U8lFjLGRTJHeFd+BGeHsEk+AHfddTX'
const aes256Cipher = createCipher(CONFIG_SECRETS_KEY)

function cipher(cleartext) {
  return aes256Cipher.encrypt(cleartext)
}

function decipher(encrypted) {
  return aes256Cipher.decrypt(encrypted)
}

exports.cipher = cipher
exports.decipher = decipher
