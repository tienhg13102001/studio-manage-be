/**
 * Google Apps Script — Web App nhận webhook từ backend studio-manage.
 *
 * Khi BE tạo lịch chụp, nó POST tới URL Web App này. Script sẽ:
 *   1. Xác thực `secret` khớp Script Property "SECRET".
 *   2. Trong ROOT_FOLDER_ID: tìm (hoặc tạo) folder theo tên mùa, rồi tìm-hoặc-tạo
 *      folder bộ ảnh con theo tên trường/lớp/ngày (đã tồn tại thì dùng lại, không
 *      tạo trùng).
 *   3. Trong Google Sheet (SHEET_ID): tìm (hoặc tạo) tab theo tên mùa. Tìm dòng
 *      theo scheduleId — đã có thì cập nhật dòng đó, chưa có thì thêm dòng mới.
 *   4. Trả JSON { ok, folderId, folderUrl }.
 *
 * Folder ảnh thuộc về LỚP: nếu body.folderId (folder đã lưu trên lớp) còn dùng được
 * thì dùng lại folder đó thay vì tìm/tạo theo tên.
 *
 * body.action === 'folder': chỉ tìm/tạo folder ảnh cho lớp (chưa có lịch chụp) — không
 * ghi Sheet. Trả { ok, folderId, folderUrl }.
 *
 * Khi XOÁ lịch chụp (body.action === 'delete'): xoá dòng tương ứng trong Sheet (theo
 * scheduleId); chỉ chuyển folder vào thùng rác nếu body.folderId được gửi (backend
 * hiện KHÔNG gửi vì folder thuộc về lớp).
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

// Backend chỉ tin `folderId` trả về (thay folder đã lưu trên lớp) / action 'folder' khi script
// đủ mới — tăng số này khi đổi giao thức.
var SCRIPT_VERSION = 2;

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

    if (body.action === 'delete') {
      return _handleDelete(body, sheetId);
    }

    var seasonName = body.season || 'Chưa phân mùa';

    // 1. Folder của lớp (nếu có) → dùng lại; không thì tìm/tạo folder mùa, rồi
    //    tìm-hoặc-tạo folder bộ ảnh (không tạo trùng)
    var folder = _getExistingFolder(body.folderId);
    if (!folder) {
      var root = DriveApp.getFolderById(rootId);
      var seasonFolder = _getOrCreateChildFolder(root, seasonName);
      folder = _getOrCreateChildFolder(seasonFolder, _buildFolderName(body));
    }
    var folderId = folder.getId();
    var folderUrl = folder.getUrl();

    if (body.action === 'folder') {
      return _json({
        ok: true,
        action: 'folder',
        scriptVersion: SCRIPT_VERSION,
        folderId: folderId,
        folderUrl: folderUrl,
      });
    }

    // 2. Tìm/tạo tab theo tên mùa
    var ss = SpreadsheetApp.openById(sheetId);
    var sheet = ss.getSheetByName(seasonName);
    if (!sheet) {
      sheet = ss.insertSheet(seasonName);
    }
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(HEADERS);
    }

    // 3. Tìm dòng theo scheduleId → có thì cập nhật, chưa có thì thêm mới
    var scheduleId = body.scheduleId || '';
    var existingRow = scheduleId ? _findRowByScheduleId(sheet, scheduleId) : -1;
    var createdAt =
      existingRow > 0 ? sheet.getRange(existingRow, 1).getValue() || new Date() : new Date();

    var rowValues = [
      createdAt,
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
      scheduleId,
    ];

    if (existingRow > 0) {
      sheet.getRange(existingRow, 1, 1, rowValues.length).setValues([rowValues]);
    } else {
      sheet.appendRow(rowValues);
    }

    return _json({
      ok: true,
      scriptVersion: SCRIPT_VERSION,
      folderId: folderId,
      folderUrl: folderUrl,
    });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}

// Folder theo id còn tồn tại và chưa bị xoá → trả về; không thì null.
function _getExistingFolder(folderId) {
  if (!folderId) return null;
  try {
    var f = DriveApp.getFolderById(folderId);
    return f.isTrashed() ? null : f;
  } catch (err) {
    return null;
  }
}

function _getOrCreateChildFolder(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

// Xoá khi nhận action 'delete': bỏ folder vào thùng rác + xoá dòng Sheet.
function _handleDelete(body, sheetId) {
  var trashedFolder = false;
  var deletedRow = false;

  // 1. Chuyển folder bộ ảnh vào thùng rác (theo folderId)
  if (body.folderId) {
    try {
      DriveApp.getFolderById(body.folderId).setTrashed(true);
      trashedFolder = true;
    } catch (err) {
      // folder không tồn tại / đã xoá → bỏ qua
    }
  }

  // 2. Xoá dòng tương ứng trong tab mùa (theo scheduleId)
  var scheduleId = body.scheduleId || '';
  var seasonName = body.season || 'Chưa phân mùa';
  if (scheduleId) {
    var ss = SpreadsheetApp.openById(sheetId);
    var sheet = ss.getSheetByName(seasonName);
    if (sheet) {
      var row = _findRowByScheduleId(sheet, scheduleId);
      if (row > 0) {
        sheet.deleteRow(row);
        deletedRow = true;
      }
    }
  }

  return _json({ ok: true, trashedFolder: trashedFolder, deletedRow: deletedRow });
}

// Tìm dòng có scheduleId (cột cuối) khớp; trả về số dòng (1-based) hoặc -1.
function _findRowByScheduleId(sheet, scheduleId) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1; // chỉ có header hoặc rỗng
  var col = HEADERS.length; // scheduleId là cột cuối cùng
  var values = sheet.getRange(2, col, lastRow - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]) === String(scheduleId)) {
      return i + 2; // +2 vì bắt đầu từ dòng 2
    }
  }
  return -1;
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
