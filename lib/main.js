const path = require('path')
const { officeDocuments, response } = require('jsreport-office')

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

      const isPreview = req.options.preview === true || req.options.preview === 'true'
      let officeDocumentType
      let officeDocumentContent

      if (
        isPreview &&
        res.meta.officeDocumentContent != null
      ) {
        officeDocumentType = officeDocuments.getDocumentTypes().includes(res.meta.fileExtension) ? res.meta.fileExtension : undefined
        officeDocumentContent = res.meta.officeDocumentContent
      } else if (!isPreview) {
        officeDocumentType = officeDocuments.getDocumentType(res.meta.contentType)
        officeDocumentContent = res.content
      }

      if (!officeDocumentType) {
        return
      }

      let password

      if (req.template.officePassword.passwordRaw) {
        password = req.template.officePassword.passwordRaw
      } else if (req.template.officePassword.passwordSecure) {
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

      if (!password) {
        throw reporter.createError('password was not set, you must supply a password when office-password is enabled', {
          statusCode: 4000
        })
      }

      reporter.logger.debug(`office-password starting to add password to office file "${officeDocumentType}"`, req)

      const result = await reporter.executeScript({
        officeContent: officeDocumentContent.toString('base64'),
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

      reporter.logger.debug(`office-password finished adding password to office file "${officeDocumentType}"`, req)

      const officeDocumentBuf = Buffer.from(result.officeContent, 'base64')

      if (isPreview) {
        await response({
          previewOptions: { enabled: true, publicUri: res.meta.previewPublicUri },
          officeDocumentType,
          buffer: officeDocumentBuf
        }, req, res)
      } else {
        res.content = officeDocumentBuf
      }
    })
  })
}
