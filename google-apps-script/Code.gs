/**
 * Google Apps Script — Web App nhận webhook từ backend studio-manage.
 *
 * Khi BE tạo lịch chụp, nó POST tới URL Web App này. Script sẽ:
 *   1. Xác thực `secret` khớp Script Property "SECRET".
 *   2. Trong ROOT_FOLDER_ID: tìm (hoặc tạo) folder theo tên mùa, rồi tạo folder
 *      bộ ảnh con đặt tên theo trường/lớp/ngày bên trong folder mùa đó.
 *   3. Trong Google Sheet (SHEET_ID): tìm (hoặc tạo) tab theo tên mùa rồi ghi 1
 *      dòng vào đó.
 *   4. Trả JSON { ok, folderId, folderUrl }.
 *
 * ─── Cấu hình (Project Settings → Script Properties) ───
 *   SECRET          : chuỗi bí mật, trùng GAS_WEBHOOK_SECRET bên backend
 *   ROOT_FOLDER_ID  : ID folder gốc trên Drive (chứa các folder theo mùa)
 *   SHEET_ID        : ID Google Sheet quản lý
 *
 * ─── Deploy ───
 *   Deploy → New deployment → Type: Web app
 *     - Execute as: Me
 *     - Who has access: Anyone
 *   Copy "Web app URL" → dán vào GAS_WEBHOOK_URL bên backend .env
 *   (Mỗi lần sửa code phải tạo "New version" khi deploy thì mới có hiệu lực.)
 */

var HEADERS = [
  'Ngày tạo',
  'Trường',
  'Lớp',
  'Ngày chụp',
  'Giờ',
  'Địa điểm',
  'Thợ chính',
  'Thợ phụ',
  'Link folder',
  'Trạng thái',
  'Link hợp đồng',
  'scheduleId',
];

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var props = PropertiesService.getScriptProperties();

    var secret = props.getProperty('SECRET');
    if (secret && body.secret !== secret) {
      return _json({ ok: false, error: 'unauthorized' });
    }

    var rootId = props.getProperty('ROOT_FOLDER_ID');
    var sheetId = props.getProperty('SHEET_ID');
    if (!rootId || !sheetId) {
      return _json({ ok: false, error: 'missing ROOT_FOLDER_ID or SHEET_ID' });
    }

    var seasonName = body.season || 'Chưa phân mùa';

    // 1. Tìm/tạo folder mùa trong folder gốc, rồi tạo folder bộ ảnh bên trong
    var root = DriveApp.getFolderById(rootId);
    var seasonFolder = _getOrCreateChildFolder(root, seasonName);
    var folderName = _buildFolderName(body);
    var folder = seasonFolder.createFolder(folderName);
    var folderId = folder.getId();
    var folderUrl = folder.getUrl();

    // 2. Tìm/tạo tab theo tên mùa rồi ghi 1 dòng
    var ss = SpreadsheetApp.openById(sheetId);
    var sheet = ss.getSheetByName(seasonName);
    if (!sheet) {
      sheet = ss.insertSheet(seasonName);
    }
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(HEADERS);
    }
    sheet.appendRow([
      new Date(),
      body.school || '',
      body.className || '',
      body.shootDate || '',
      body.startTime || '',
      body.location || '',
      body.leadPhotographer || '',
      (body.supportPhotographers || []).join(', '),
      folderUrl,
      body.status || '',
      body.contractUrl || '',
      body.scheduleId || '',
    ]);

    return _json({ ok: true, folderId: folderId, folderUrl: folderUrl });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}

function _getOrCreateChildFolder(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function _buildFolderName(body) {
  // Định dạng: "9/6/2026 - 9A1 THCS Xín Cái - Địa điểm"
  var classSchool = [body.className, body.school]
    .filter(function (p) {
      return p;
    })
    .join(' ');
  var parts = [body.shootDate, classSchool, body.location].filter(function (p) {
    return p;
  });
  return parts.join(' - ') || 'Bộ ảnh mới';
}

function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON,
  );
}
