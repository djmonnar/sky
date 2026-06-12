// Vercel CLI가 한글 Windows 계정명을 HTTP 헤더에 넣어 실패하는 문제 우회
const os = require("os");
const origUserInfo = os.userInfo;
os.userInfo = function (...args) {
  const u = origUserInfo.apply(os, args);
  try { return Object.assign(Object.create(Object.getPrototypeOf(u)), u, { username: "djmon" }); }
  catch { return { ...u, username: "djmon" }; }
};
const origHostname = os.hostname;
os.hostname = function () {
  const h = origHostname.call(os);
  return /^[\x20-\x7e]*$/.test(h) ? h : "djmon-pc";
};
