// Custom signing script for electron-builder
// Signs the Windows installer using certificate from Windows Certificate Store

const { execSync } = require('child_process');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables from .env file
dotenv.config({ path: path.join(__dirname, '../../.env') });

exports.default = async function (configuration) {
  const filePath = configuration.path;

  if (!filePath) {
    throw new Error('File path not provided for signing');
  }

  // Get certificate thumbprint from environment variable
  const certThumbprint = process.env.WINDOWS_CERT_THUMBPRINT;

  if (!certThumbprint) {
    throw new Error('WINDOWS_CERT_THUMBPRINT environment variable is not set in .env file');
  }

  console.log(`\n🔐 Signing: ${filePath}`);

  try {
    // Sign using certificate thumbprint from Windows Certificate Store
    const signCommand = `signtool sign /sha1 ${certThumbprint} /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 "${filePath}"`;

    console.log(`Executing: ${signCommand}`);

    const output = execSync(signCommand, {
      encoding: 'utf8',
      stdio: 'inherit'
    });

    console.log(`✅ Successfully signed: ${path.basename(filePath)}\n`);
  } catch (error) {
    console.error(`❌ Signing failed for: ${filePath}`);
    console.error(error.message);
    throw error;
  }
};
