/**
 * Số thợ: crew = floor(n / k); phần dư > k/2 (hơn 50%) thì +1; có học sinh thì tối thiểu 1 thợ.
 * k thiếu/0 → null. Giữ đồng bộ với frontend/src/utils/crewCount.ts.
 */
function calcCrewCount(total, studentsPerCrew) {
  let k = Number(studentsPerCrew);
  if (!isFinite(k) || k <= 0) return null;
  let n = Number(total);
  if (!isFinite(n) || n <= 0) return 0;
  let crew = Math.floor(n / k);
  if (n % k > k / 2) crew += 1;
  return Math.max(crew, 1);
}

// Ô tiền cọc / còn lại khi lớp chưa có tiền cọc (hợp đồng tạo trước khi cọc)
const BLANK_AMOUNT = "………………";
// Tên Named Range đánh dấu các ô để cập nhật lại sau (action updateDeposit)
const RANGE_DEPOSIT = "yume_deposit";
const RANGE_REMAINING = "yume_remaining";

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Tiền cọc hợp lệ (> 0) hoặc null (chưa cọc). */
function parseDeposit(v) {
  let n = Number(v);
  return v !== null && v !== undefined && v !== "" && isFinite(n) && n > 0 ? n : null;
}

/** Chuỗi in ra cho ô Tiền cọc / Đợt 2: số tiền, hoặc "………" khi chưa có cọc. */
function depositTexts(depositAmount, totalPayment) {
  if (depositAmount === null) return { deposit: BLANK_AMOUNT, remaining: BLANK_AMOUNT };
  let total = Number(totalPayment) || 0;
  let remaining = total > depositAmount ? total - depositAmount : 0;
  return { deposit: formatVndDoc(depositAmount), remaining: formatVndDoc(remaining) };
}

/**
 * Thay `[start, end]` của `el` bằng `value`: chèn trước rồi mới xoá → giữ định dạng của đoạn
 * cũ và phần tử text không bao giờ bị rỗng (rỗng thì Docs có thể gộp/xoá phần tử).
 * Sau lệnh này `value` nằm ở [start, start + value.length - 1].
 */
function replaceTextRange(el, start, end, value) {
  if (end >= start) {
    el.insertText(end + 1, value);
    el.deleteText(start, end);
  } else {
    el.insertText(start, value);
  }
}

/** Đánh dấu [start, start + value.length - 1] của `el` bằng Named Range `rangeName`. */
function addTrackedRange(doc, el, start, value, rangeName) {
  let rb = doc.newRange();
  rb.addElement(el, start, start + value.length - 1);
  doc.addNamedRange(rangeName, rb.build());
}

/**
 * Thay MỌI chỗ `placeholder` trong body bằng `value` và đánh dấu từng chỗ bằng Named Range
 * `rangeName` (để action updateDeposit tìm lại và sửa đúng ô đó trong hợp đồng đã tạo).
 * Gọi SAU mọi thao tác khác trên body (ngay trước saveAndClose) để range không bị xê dịch/mất.
 */
function fillTrackedPlaceholder(doc, body, placeholder, value, rangeName) {
  // findText dùng regex → escape {{ }}
  let pattern = placeholder.replace(/[{}]/g, "\\$&");
  let found = body.findText(pattern);
  let guard = 0;
  while (found && guard < 50) {
    guard++;
    let el = found.getElement().asText();
    let start = found.getStartOffset();
    replaceTextRange(el, start, found.getEndOffsetInclusive(), value);
    addTrackedRange(doc, el, start, value, rangeName);
    // Chỗ vừa thay không còn khớp → tìm lại từ đầu
    found = body.findText(pattern);
  }
}

/**
 * Sửa lại text của mọi Named Range `rangeName` thành `value` rồi đánh dấu lại (độ dài text đổi).
 * Mỗi range được lấy lại theo id ngay trước khi sửa (Docs tự dời offset của range sau mỗi lần
 * sửa) → không dùng offset cũ. Trả về số range đã thực sự ghi lại.
 */
function updateTrackedRanges(doc, rangeName, value) {
  let ids = doc.getNamedRanges(rangeName).map(function (nr) {
    return nr.getId();
  });
  let updated = 0;
  // Duyệt ngược (range tạo sau nằm sau trong văn bản); offset luôn lấy mới theo id nên an toàn
  for (let k = ids.length - 1; k >= 0; k--) {
    let nr = doc.getNamedRangeById(ids[k]);
    if (!nr) continue;
    let elements = nr.getRange().getRangeElements();
    // Bỏ range cũ TRƯỚC khi sửa, rồi mới đánh dấu lại range mới
    nr.remove();
    if (!elements.length) continue;
    let first = elements[0];
    let el = first.getElement().editAsText();
    let start = first.isPartial() ? first.getStartOffset() : 0;
    let end = first.isPartial() ? first.getEndOffsetInclusive() : el.getText().length - 1;
    // Range trải nhiều phần tử (hiếm) → xoá phần thừa ở các phần tử sau (từ cuối lên)
    for (let i = elements.length - 1; i >= 1; i--) {
      let re = elements[i];
      let t = re.getElement().editAsText();
      if (re.isPartial()) t.deleteText(re.getStartOffset(), re.getEndOffsetInclusive());
      else if (t.getText().length) t.deleteText(0, t.getText().length - 1);
    }
    replaceTextRange(el, start, end, value);
    addTrackedRange(doc, el, start, value, rangeName);
    updated++;
  }
  return updated;
}

/**
 * action "updateDeposit": cập nhật ô Tiền cọc + Đợt 2 trong hợp đồng ĐÃ TẠO
 * { action, documentId, depositAmount, totalPayment, secret }.
 * BẮT BUỘC Script Property SECRET và `secret` phải khớp (thiếu → từ chối).
 */
function handleUpdateDeposit(data) {
  let secret = PropertiesService.getScriptProperties().getProperty("SECRET");
  if (!secret || data.secret !== secret) {
    return jsonOut({ success: false, reason: "unauthorized" });
  }
  if (!data.documentId) return jsonOut({ success: false, reason: "missing_document_id" });

  let lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return jsonOut({ success: false, reason: "busy" });
  }
  try {
    let doc = DocumentApp.openById(data.documentId);
    if (!doc.getNamedRanges(RANGE_DEPOSIT).length && !doc.getNamedRanges(RANGE_REMAINING).length) {
      // Hợp đồng tạo trước khi có cơ chế đánh dấu → không biết ô nào để sửa
      return jsonOut({ success: false, reason: "no_named_ranges" });
    }
    let depositAmount = parseDeposit(data.depositAmount);
    let texts = depositTexts(depositAmount, data.totalPayment);
    let updated =
      updateTrackedRanges(doc, RANGE_DEPOSIT, texts.deposit) +
      updateTrackedRanges(doc, RANGE_REMAINING, texts.remaining);
    doc.saveAndClose();
    if (!updated) return jsonOut({ success: false, reason: "empty_ranges" });
    return jsonOut({ success: true, updated: updated, depositAmount: depositAmount });
  } finally {
    lock.releaseLock();
  }
}

function doPost(e) {
  try {
    // 1. Nhận và Parse dữ liệu JSON
    let data = JSON.parse(e.postData.contents);

    if (data.action === "updateDeposit") return handleUpdateDeposit(data);

    // ==========================================
    // CẤU HÌNH ID
    const TEMPLATE_ID = '1ZJizJSeOz0diXENnLCZI3a_1ZFdC-Orm0BVfeqlsDIg';
    const ROOT_FOLDER_ID = '1GylKXVdBXIMnx9FhwLg6MDFFRI7d7YKA';
    // ==========================================

    // 2. Trích xuất dữ liệu từ JSON
    let contactName = data.contactName || "Chưa có tên hs";
    let contactPhone = data.contactPhone || "Chưa có SĐT";
    let className = (data.customer && data.customer.className) ? data.customer.className : "Chưa có lớp";
    let school = (data.customer && data.customer.school) ? data.customer.school : "Chưa có trường";

    let location = data.location || "Chưa có địa điểm";
    let customerAddress = (data.customer && data.customer.contactAddress) ? data.customer.contactAddress : "Chưa có địa chỉ";

    let packageName = (data.package && data.package.name) ? data.package.name : "Chưa chọn gói";
    let pricePerMember = (data.package && data.package.pricePerMember) ? data.package.pricePerMember : 0;

    let formattedPrice = pricePerMember.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".") + " đ";

    let totalStudents = data.total || 0;
    let totalMale = data.totalMale || 0;
    let totalFemale = data.totalFemale || 0;

    let studentsPerCrew = (data.package && data.package.studentsPerCrew) ? data.package.studentsPerCrew : 0;
    // Ưu tiên số thợ gửi từ hệ thống (đã chốt trong form hợp đồng); không có thì tự tính theo quy tắc mới
    let sentCrewCount = Number(data.crewCount);
    let crewCount = (data.crewCount !== null && data.crewCount !== undefined && data.crewCount !== "" && isFinite(sentCrewCount) && sentCrewCount >= 0)
      ? sentCrewCount
      : (calcCrewCount(totalStudents, studentsPerCrew) || 0);
    // Thợ quay MV: gói có quay MV kỷ yếu → 1 thợ quay/lớp (ưu tiên số gửi từ hệ thống)
    let sentVideoCrewCount = Number(data.videoCrewCount);
    let videoCrewCount = (data.videoCrewCount !== null && data.videoCrewCount !== undefined && data.videoCrewCount !== "" && isFinite(sentVideoCrewCount) && sentVideoCrewCount >= 0)
      ? sentVideoCrewCount
      : ((data.package && data.package.hasMv) ? 1 : 0);

    let printedPhotosCount = 2 * totalStudents;

    // Tính tổng thành tiền
    let totalAmount = totalStudents * pricePerMember;
    let formattedTotalAmount = totalAmount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".") + " đ";
    let totalAmountWords = docSoTiengViet(totalAmount);

    // ── Dịch vụ sử dụng thêm (tính sớm để dùng cho tổng thanh toán) ──
    let extraServices = Array.isArray(data.extraServices) ? data.extraServices : [];
    let extraTotal = 0;
    extraServices.forEach(function (sv) {
      let qty = Number(sv.quantity) || 0;
      let price = Number(sv.unitPrice) || 0;
      let amt = Number(sv.amount);
      extraTotal += isFinite(amt) ? amt : qty * price;
    });
    let countExtraService = extraServices.length; // số dòng dịch vụ thêm
    let totalPayment = totalAmount + extraTotal; // gói chụp + dịch vụ thêm

    // Đợt 1 = tiền cọc thực tế của lớp (data.depositAmount); chưa có cọc → in "………"
    // Đợt 2 = total_payment - tiền cọc (không âm)
    let depositAmount = parseDeposit(data.depositAmount);
    let amountTexts = depositTexts(depositAmount, totalPayment);

    // Xử lý ngày chụp
    let shootDateStr = data.shootDate || "Không-rõ-ngày";
    let yearName = "Khác";
    let dayName = shootDateStr;
    let formattedDate = "";

    if (shootDateStr.includes("-")) {
      yearName = shootDateStr.split("-")[0];
      formattedDate = shootDateStr.split("-").reverse().join("/");
    }

    // 3. Xử lý thư mục lưu trữ
    let rootFolder = DriveApp.getFolderById(ROOT_FOLDER_ID);
    let yearFolder = getOrCreateFolder(rootFolder, yearName);
    let dayFolder = getOrCreateFolder(yearFolder, dayName);

    // 4. Nhân bản file mẫu
    let templateFile = DriveApp.getFileById(TEMPLATE_ID);
    let newFileName = "Hợp đồng - " + className + " " + school + " - " + contactName;
    let copiedFile = templateFile.makeCopy(newFileName, dayFolder);

    // 5. Thay thế từ khóa trong Docs
    let doc = DocumentApp.openById(copiedFile.getId());
    let body = doc.getBody();

    body.replaceText("{{contactName}}", contactName);
    body.replaceText("{{contactPhone}}", contactPhone);
    body.replaceText("{{customerAddress}}", customerAddress);
    body.replaceText("{{className}}", className);
    body.replaceText("{{school}}", school);
    body.replaceText("{{location}}", location);
    body.replaceText("{{packageName}}", packageName);
    body.replaceText("{{pricePerMember}}", formattedPrice);
    body.replaceText("{{totalStudents}}", totalStudents.toString());
    body.replaceText("{{totalMale}}", totalMale.toString());
    body.replaceText("{{totalFemale}}", totalFemale.toString());
    body.replaceText("{{crewCount}}", crewCount.toString());
    body.replaceText("{{videoCrewCount}}", videoCrewCount.toString());
    body.replaceText("{{printedPhotosCount}}", printedPhotosCount.toString());
    body.replaceText("{{totalAmount}}", formattedTotalAmount);
    body.replaceText("{{totalAmountWords}}", totalAmountWords);
    body.replaceText("{{shootDate}}", formattedDate);

    // ── Render dịch vụ sử dụng thêm (đã tính extraTotal/totalPayment ở trên) ──
    // Tổng tiền dịch vụ thêm (xuất hiện ở cả bảng dịch vụ & bảng thanh toán)
    body.replaceText("{{total_ammount_extraService}}", formatVndDoc(extraTotal));
    // Số lượng dịch vụ sử dụng thêm
    body.replaceText("{{count_extraService}}", countExtraService.toString());
    // Tổng thanh toán hợp đồng = chi phí gói + dịch vụ thêm
    body.replaceText("{{total_payment}}", formatVndDoc(totalPayment));
    // Điền bảng dịch vụ — nhân hàng mẫu {{sv_name}} cho từng dịch vụ
    fillExtraServices(body, extraServices);

    // Tiền cọc đợt 1 / còn lại đợt 2: thay tại chỗ + Named Range để cập nhật về sau.
    // Làm cuối cùng để các thao tác khác (nhân/xoá hàng bảng…) không làm mất/lệch range.
    fillTrackedPlaceholder(doc, body, "{{depositAmount}}", amountTexts.deposit, RANGE_DEPOSIT);
    fillTrackedPlaceholder(doc, body, "{{remainingAmount}}", amountTexts.remaining, RANGE_REMAINING);

    doc.saveAndClose();

    // 6. Trả về kết quả
    let response = {
      "status": "success",
      "message": "Đã tạo hợp đồng thành công!",
      "folder_path": yearName + "/" + dayName,
      "document_url": doc.getUrl(),
      "documentId": doc.getId(),
      "totalPayment": totalPayment,
      // Số tiền cọc đã in (null = để trống "………")
      "depositAmount": depositAmount
    };

    return jsonOut(response);

  } catch (error) {
    let errorResponse = {
      "status": "error",
      "message": "Lỗi: " + error.message
    };
    return ContentService.createTextOutput(JSON.stringify(errorResponse))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function getOrCreateFolder(parentFolder, folderName) {
  let folderIterator = parentFolder.getFoldersByName(folderName);
  if (folderIterator.hasNext()) {
    return folderIterator.next();
  } else {
    return parentFolder.createFolder(folderName);
  }
}

// Định dạng tiền: 1234567 -> "1.234.567 đ"
function formatVndDoc(n) {
  let num = Number(n) || 0;
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".") + " đ";
}

/**
 * Render danh sách dịch vụ sử dụng thêm vào bảng trong template.
 *
 * Template phải có 1 bảng chứa ĐÚNG 1 hàng dữ liệu mẫu với các token:
 *   {{sv_name}} | {{sv_qty}} | {{sv_price}} | {{sv_amount}} | {{sv_note}}
 * (chỉ cần các token bạn muốn hiển thị; có thể bỏ bớt cột). Mỗi dịch vụ sẽ nhân
 * thành 1 hàng; hàng mẫu bị xoá. Nếu không có dịch vụ, hàng mẫu cũng bị xoá.
 */
function fillExtraServices(body, services) {
  let tables = body.getTables();
  let table = null;
  let tplIndex = -1;

  for (let t = 0; t < tables.length && !table; t++) {
    for (let r = 0; r < tables[t].getNumRows(); r++) {
      if (tables[t].getRow(r).getText().indexOf("{{sv_name}}") !== -1) {
        table = tables[t];
        tplIndex = r;
        break;
      }
    }
  }
  if (!table) return; // template không có bảng dịch vụ → bỏ qua

  let tplRow = table.getRow(tplIndex);

  if (!services || services.length === 0) {
    table.removeRow(tplIndex); // không có dịch vụ → xoá hàng mẫu
    return;
  }

  for (let i = 0; i < services.length; i++) {
    let sv = services[i];
    let qty = Number(sv.quantity) || 0;
    let price = Number(sv.unitPrice) || 0;
    let amount = Number(sv.amount);
    if (!isFinite(amount)) amount = qty * price;

    let row = tplRow.copy();
    row.replaceText("{{sv_name}}", sv.name || "");
    row.replaceText("{{sv_qty}}", String(qty));
    row.replaceText("{{sv_price}}", formatVndDoc(price));
    row.replaceText("{{sv_amount}}", formatVndDoc(amount));
    row.replaceText("{{sv_note}}", sv.note || "");
    table.insertTableRow(tplIndex + 1 + i, row);
  }
  table.removeRow(tplIndex);
}

function docSoTiengViet(so) {
  if (so === 0) return "Không đồng";

  const chuSo = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"];

  function docBlock3ChuSo(n, docKhongTram) {
    let tram = Math.floor(n / 100);
    let chuc = Math.floor((n % 100) / 10);
    let donVi = n % 10;
    let ketQua = "";

    if (docKhongTram || tram > 0) {
      let tramText = chuSo[tram];
      ketQua += tramText + " trăm ";
    }

    if (chuc > 1) {
      let chucText = chuSo[chuc];
      ketQua += chucText + " mươi ";
    } else if (chuc === 1) {
      ketQua += "mười ";
    } else if ((docKhongTram || tram > 0) && donVi > 0) {
      let leText = "lẻ ";
      ketQua += leText;
    }

    if (chuc > 0 && donVi === 5) {
      let lamText = "lăm";
      ketQua += lamText;
    } else if (chuc > 1 && donVi === 1) {
      let motText = "mốt";
      ketQua += motText;
    } else if (donVi > 0) {
      let donViText = chuSo[donVi];
      ketQua += donViText;
    }

    return ketQua.trim();
  }

  let chuoi = "";
  let blocks = [];
  let tempSo = so;

  while (tempSo > 0) {
    blocks.push(tempSo % 1000);
    tempSo = Math.floor(tempSo / 1000);
  }

  const donViLon = ["", " nghìn", " triệu", " tỷ", " nghìn tỷ", " triệu tỷ"];
  let coBlockKhacKhong = false;

  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i] > 0) {
      let docKhongTram = coBlockKhacKhong;
      let blockText = docBlock3ChuSo(blocks[i], docKhongTram);
      let donViText = donViLon[i];
      chuoi += " " + blockText + donViText;
      coBlockKhacKhong = true;
    }
  }

  chuoi = chuoi.trim();
  if (chuoi.length > 0) {
    let checkText = chuoi.charAt(0).toUpperCase() + chuoi.slice(1) + " đồng";
    chuoi = checkText;
  }

  return chuoi.replace(/\s+/g, ' ');
}