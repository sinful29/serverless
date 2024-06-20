import fs from 'fs'
import path from 'path'
import archiver from 'archiver'
import BbPromise from 'bluebird'
import walkDirSync from './walk-dir-sync.js'

async function createZipFile(srcDirPath, outputFilePath) {
  const files = walkDirSync(srcDirPath).map((file) => ({
    input: file,
    output: file.replace(path.join(srcDirPath, path.sep), ''),
  }))

  return new BbPromise((resolve, reject) => {
    const output = fs.createWriteStream(outputFilePath)
    const archive = archiver('zip', {
      zlib: { level: 9 },
    })

    output.on('open', () => {
      archive.pipe(output)

      files.forEach((file) => {
        // TODO: update since this is REALLY slow
        if (fs.lstatSync(file.input).isFile()) {
          archive.append(fs.createReadStream(file.input), {
            name: file.output,
          })
        }
      })

      archive.finalize()
    })

    archive.on('error', (err) => reject(err))
    output.on('close', () => resolve(outputFilePath))
  })
}

export default createZipFile
