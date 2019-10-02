const Encryptor = require('xlsx-populate/lib/Encryptor')

module.exports = async (inputs, callback, done) => {
  try {
    const officeBuf = Buffer.from(inputs.officeContent, 'base64')
    const password = inputs.password

    const encryptor = new Encryptor()

    const protectedOfficeBuf = encryptor.encrypt(officeBuf, password)

    done(null, {
      officeContent: protectedOfficeBuf.toString('base64')
    })
  } catch (e) {
    done(null, {
      error: {
        message: e.message,
        stack: e.stack
      }
    })
  }
}
