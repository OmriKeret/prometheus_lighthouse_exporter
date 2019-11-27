const { Storage } = require('@google-cloud/storage');
const projectId = process.env.GCS_PROJECT_ID;
const keyFileName = process.env.GCS_KEY_FILE_NAME;
const storage = new Storage({
  projectId,
  keyFileName
});

module.exports = {
  /**
   * @name uploadFile
   * upload a file from dist to provided bucket
   * @param {string} content
   * @param {string} filePath
   * @param {string} bucketName
   */
  uploadFile(content, filePath, bucketName) {
    const myBucket = storage.bucket(bucketName);
    const file = myBucket.file(filePath);
    return file.save(content);
  }
};
