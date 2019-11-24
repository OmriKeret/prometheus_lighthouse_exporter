const { Storage } = require('@google-cloud/storage');
const storage = new Storage();

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

    return file.save(contents)
};
