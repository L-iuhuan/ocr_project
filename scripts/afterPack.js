// afterPack hook: Windows icon embedding + macOS ad-hoc codesigning
exports.default = async function (context) {
  var path = require('path');

  if (context.electronPlatformName === 'win32') {
    var { rcedit } = require('rcedit');
    var icon = path.join(context.packager.projectDir, 'ocr.ico');
    var exe = path.join(context.appOutDir, context.packager.appInfo.productFilename + '.exe');
    try {
      await rcedit(exe, { icon: icon });
      console.log('  • icon embedded  exe=' + exe + ' icon=' + icon);
    } catch (e) {
      console.error('  ⨯ icon embed failed:', e.message);
    }
  }

  if (context.electronPlatformName === 'darwin') {
    // ad-hoc sign the .app bundle so macOS no longer reports "damaged".
    // Without this a zero-identity build produces a broken signature that
    // Gatekeeper rejects entirely instead of showing the right-click bypass.
    var cp = require('child_process');
    var appBundle = path.join(context.appOutDir, context.packager.appInfo.productFilename + '.app');
    try {
      cp.execSync('codesign --force --deep --sign - "' + appBundle + '"', { stdio: 'pipe' });
      console.log('  • ad-hoc signed  app=' + appBundle);
    } catch (e) {
      console.error('  ⨯ ad-hoc sign failed:', e.message);
    }
  }
};
