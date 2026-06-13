// Set EXE icon using locally installed rcedit (no GitHub download needed)
exports.default = async function (context) {
  if (context.electronPlatformName !== 'win32') return;
  var path = require('path');
  var { rcedit } = require('rcedit');
  var icon = path.join(context.packager.projectDir, 'ocr.ico');
  var exe = path.join(context.appOutDir, context.packager.appInfo.productFilename + '.exe');
  try {
    await rcedit(exe, { icon: icon });
    console.log('  • icon embedded  exe=' + exe + ' icon=' + icon);
  } catch (e) {
    console.error('  ⨯ icon embed failed:', e.message);
  }
};
