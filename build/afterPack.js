// macOS ad-hoc signing hook for electron-builder
// 给打包后的 .app 做 ad-hoc 签名 (codesign -s -)，让 macOS 不报"已损坏"
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

exports.default = async function (context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);
  if (!fs.existsSync(appPath)) {
    console.log(`[afterPack] .app not found at ${appPath}, skip ad-hoc signing`);
    return;
  }

  try {
    console.log(`[afterPack] Ad-hoc signing ${appPath} ...`);
    execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'inherit' });
    console.log(`[afterPack] Ad-hoc signing done.`);
  } catch (e) {
    console.error(`[afterPack] Ad-hoc signing failed:`, e.message);
  }
};
