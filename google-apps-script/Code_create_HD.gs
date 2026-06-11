function doPost(e) {
  try {
    // 1. Nhận và Parse dữ liệu JSON
    let data = JSON.parse(e.postData.contents);

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
    let crewCount = 0;
    if (studentsPerCrew > 0) {
      crewCount = Math.floor(totalStudents / studentsPerCrew);
    }

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

    // Tính Đợt 1 (Cố định 500k) và Đợt 2 (Phần còn lại = tổng thanh toán - cọc)
    let depositAmount = 500000;
    let formattedDepositAmount = depositAmount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".") + " đ";

    // Đợt 2 = total_payment - depositAmount (không âm)
    let remainingAmount = totalPayment > depositAmount ? totalPayment - depositAmount : 0;
    let formattedRemainingAmount = remainingAmount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".") + " đ";

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
    body.replaceText("{{printedPhotosCount}}", printedPhotosCount.toString());
    body.replaceText("{{totalAmount}}", formattedTotalAmount);
    body.replaceText("{{totalAmountWords}}", totalAmountWords);
    body.replaceText("{{depositAmount}}", formattedDepositAmount); // Tiền cọc đợt 1
    body.replaceText("{{remainingAmount}}", formattedRemainingAmount); // Tiền còn lại đợt 2
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

    doc.saveAndClose();

    // 6. Trả về kết quả
    let response = {
      "status": "success",
      "message": "Đã tạo hợp đồng thành công!",
      "folder_path": yearName + "/" + dayName,
      "document_url": doc.getUrl()
    };

    return ContentService.createTextOutput(JSON.stringify(response))
      .setMimeType(ContentService.MimeType.JSON);

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