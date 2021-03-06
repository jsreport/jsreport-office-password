const path = require('path')

const missingSecretMessage = 'office-password extension uses encryption to store sensitive data and needs secret key to be defined. Please fill "encryption.secretKey" at the root of the config or disable encryption using "encryption.enabled=false".'

module.exports = function (reporter, definition) {
  reporter.documentStore.registerComplexType('OfficePasswordTemplateType', {
    passwordRaw: { type: 'Edm.String', visible: false },
    passwordSecure: { type: 'Edm.String', encrypted: true, visible: false },
    passwordFilled: { type: 'Edm.Boolean' },
    enabled: { type: 'Edm.Boolean' }
  })

  reporter.documentStore.model.entityTypes.TemplateType.officePassword = {
    type: 'jsreport.OfficePasswordTemplateType'
  }

  reporter.initializeListeners.add(definition.name, () => {
    reporter.documentStore.collection('templates').beforeInsertListeners.add(definition.name, async (doc, req) => {
      if (!doc.officePassword || !doc.officePassword.passwordRaw) {
        return
      }

      try {
        doc.officePassword.passwordSecure = await reporter.encryption.encrypt(doc.officePassword.passwordRaw)
      } catch (e) {
        if (e.encryptionNoSecret) {
          e.message = missingSecretMessage
        }

        throw e
      }

      doc.officePassword.passwordRaw = null
      doc.officePassword.passwordFilled = true
    })

    reporter.documentStore.collection('templates').beforeUpdateListeners.add(definition.name, async (q, u, req) => {
      if (!u.$set.officePassword || !u.$set.officePassword.passwordRaw) {
        return
      }

      try {
        u.$set.officePassword.passwordSecure = await reporter.encryption.encrypt(u.$set.officePassword.passwordRaw)
      } catch (e) {
        if (e.encryptionNoSecret) {
          e.message = missingSecretMessage
        }

        throw e
      }

      u.$set.officePassword.passwordRaw = null
      u.$set.officePassword.passwordFilled = true
    })

    reporter.afterRenderListeners.insert({ before: 'scripts' }, definition.name, async (req, res) => {
      if (!req.template.officePassword || req.template.officePassword.enabled === false) {
        return
      }

      if (res.meta.officeDocumentType == null) {
        reporter.logger.debug('Skipping office-password generation, the feature is disabled during preview requests')
        return
      }

      let password = req.template.officePassword.password

      if (password == null) {
        if (!req.template.officePassword.passwordSecure) {
          throw reporter.createError('password was not set, you must supply a password when office-password is enabled', {
            statusCode: 4000
          })
        }

        try {
          password = await reporter.encryption.decrypt(req.template.officePassword.passwordSecure)
        } catch (e) {
          if (e.encryptionNoSecret) {
            e.message = missingSecretMessage
          } else if (e.encryptionDecryptFail) {
            e.message = 'office-password data decrypt failed, looks like secret key value is different to the key used to encrypt sensitive data, make sure "encryption.secretKey" was not changed'
          }

          throw e
        }
      }

      reporter.logger.debug(`office-password starting to add password to office file "${res.meta.officeDocumentType}"`, req)

      const result = await reporter.executeScript({
        officeContent: res.content.toString('base64'),
        password
      }, {
        execModulePath: path.join(__dirname, 'scriptOfficePassword.js')
      }, req)

      if (result.error) {
        const error = new Error(result.error.message)
        error.stack = result.error.stack

        throw reporter.createError('Error while adding password to office file', {
          original: error,
          weak: true
        })
      }

      reporter.logger.debug(`office-password finished adding password to office file "${res.meta.officeDocumentType}"`, req)

      res.content = Buffer.from(result.officeContent, 'base64')
    })
  })
}
