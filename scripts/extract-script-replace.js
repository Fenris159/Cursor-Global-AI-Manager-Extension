const fs = require("fs");
const path = require("path");
const extPath = path.join(__dirname, "..", "src", "extension.ts");
const managerPath = path.join(__dirname, "..", "media", "manager.js");
let s = fs.readFileSync(extPath, "utf8");

// The big manager script (in body) starts with this unique string:
const scriptStart =
  "  <script>\r\n    (function() {\r\n      var vscode = acquireVsCodeApi();";
const endMark = "  <\\/script>";

const start = s.indexOf(scriptStart);
if (start === -1) {
  console.error("Manager script start not found");
  process.exit(1);
}

// Find the *last* closing script tag (the one that closes the big script, before </body>)
const lastClose = s.lastIndexOf(endMark);
if (lastClose === -1 || lastClose <= start) {
  console.error("Manager script end not found");
  process.exit(1);
}

// Extract script content (between <script> and </script>, trim)
const scriptContent = s
  .slice(start + 10, lastClose)
  .trimEnd();
fs.writeFileSync(managerPath, scriptContent, "utf8");
console.log("Wrote media/manager.js, length:", scriptContent.length);

// Remove the big inline script from extension (replace with nothing)
const newS =
  s.slice(0, start) + s.slice(lastClose + endMark.length);
fs.writeFileSync(extPath, newS);
console.log("Removed inline script from extension.ts");
