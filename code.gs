/**
 * R8 Health Resource Dashboard
 * v4: Authentication + Transaction Log + Admin Management
 * 
 * ⚠️ ก่อน deploy: เปลี่ยน FALLBACK_ADMIN_EMAIL เป็น Gmail จริงของ Admin
 */

const SPREADSHEET_ID = '1PMdzm4Not07JIqL9sf_pW_v87kKsKzLh5S7I_b4QdnE';
const VERSION = '690409'; // v4 Auth System
const CACHE_TTL_SEC = 180;

// ========================================
// Auth & Log Constants
// ========================================
const AUTH_SHEET = 'auth_users';
const LOG_SHEET = 'auth_user_log';
const T_EQ_SHEET = 't_eq_sp';
const T_SD_SHEET = 't_sd';
const T_ADMIN_SHEET = 't_admin';
const AUTH_CACHE_SEC = 300; // cache user role 5 นาที

// ⚠️ เปลี่ยนเป็น Gmail จริงของ Admin ก่อน deploy
const FALLBACK_ADMIN_EMAIL = 'adminbird@gmail.com';

// ========================================
// Web App Entry Point
// ========================================
function doGet() {
    const t = HtmlService.createTemplateFromFile('index');
    t.version = VERSION;
    return t.evaluate()
        .setTitle('R8 Health Resource Dashboard (v.' + VERSION + ')')
        .addMetaTag('viewport', 'width=device-width, initial-scale=1')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
    return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ========================================
// AUTH: ตรวจสอบสิทธิ์ผู้ใช้
// ========================================

/**
 * อ่าน header ของ auth_users แล้ว map ชื่อคอลัมน์ → column index (0-based)
 */
function _getAuthColMap(headers) {
    const map = {};
    headers.forEach((h, i) => {
        const key = String(h || '').trim().toLowerCase();
        if (key === 'email') map.email = i;
        else if (key === 'first_name' || key === 'ชื่อ') map.firstName = i;
        else if (key === 'last_name' || key === 'นามสกุล') map.lastName = i;
        else if (key === 'position' || key === 'ตำแหน่ง') map.position = i;
        else if (key === 'hospital' || key === 'สังกัด' || key === 'โรงพยาบาล') map.hospital = i;
        else if (key === 'mobile_phone_no' || key === 'phone_no' || key === 'phone' || key === 'เบอร์โทร' || key === 'line_id') map.phoneNo = i;
        else if (key === 'role' || key === 'สิทธิ์') map.role = i;
        else if (key === 'status' || key === 'สถานะ') map.status = i;
        else if (key === 'created_by') map.createdBy = i;
        else if (key === 'created_at') map.createdAt = i;
        else if (key === 'last_login') map.lastLogin = i;
    });
    return map;
}

function _getAuthColMapFresh() {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(AUTH_SHEET);
    if (!sheet) return {};
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    return _getAuthColMap(headers);
}

/**
 * ดึงข้อมูล user จาก auth_users — อ่าน header แบบ dynamic
 */
function _findUserByEmail(email) {
    if (!email) return null;
    const emailLower = email.toLowerCase().trim();

    const cache = CacheService.getScriptCache();
    const cacheKey = 'auth:' + emailLower;
    const cached = cache.get(cacheKey);
    if (cached) {
        try { return JSON.parse(cached); } catch (e) { }
    }

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(AUTH_SHEET);
    if (!sheet) return null;
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return null;

    const col = _getAuthColMap(data[0]);
    if (col.email === undefined) return null;

    for (let i = 1; i < data.length; i++) {
        if (String(data[i][col.email] || '').toLowerCase().trim() === emailLower) {
            const user = {
                email: String(data[i][col.email] || '').trim(),
                firstName: col.firstName !== undefined ? String(data[i][col.firstName] || '').trim() : '',
                lastName: col.lastName !== undefined ? String(data[i][col.lastName] || '').trim() : '',
                position: col.position !== undefined ? String(data[i][col.position] || '').trim() : '',
                hospital: col.hospital !== undefined ? String(data[i][col.hospital] || '').trim() : '',
                phoneNo: col.phoneNo !== undefined ? String(data[i][col.phoneNo] || '').trim() : '',
                role: col.role !== undefined ? String(data[i][col.role] || 'USER').trim().toUpperCase() : 'USER',
                status: col.status !== undefined ? String(data[i][col.status] || 'active').trim().toLowerCase() : 'active',
                rowIdx: i + 1,
                _colMap: col
            };
            try { cache.put(cacheKey, JSON.stringify(user), AUTH_CACHE_SEC); } catch (e) { }
            return user;
        }
    }
    return null;
}

/**
 * ล้าง cache ของ user (เรียกหลัง update ข้อมูล)
 */
function _clearUserCache(email) {
    if (!email) return;
    try {
        CacheService.getScriptCache().remove('auth:' + email.toLowerCase().trim());
    } catch (e) { }
}

/**
 * Login: เรียกจาก client เมื่อกดปุ่ม "เข้าสู่ระบบ"
 * @returns {object} { status, identity?, email? }
 */
function checkLogin() {
    const email = Session.getActiveUser().getEmail();

    // กรณีไม่ได้ login Google (ไม่ควรเกิดถ้า deploy แบบ Anyone with Google Account)
    if (!email) {
        logUserAction('', '', 'LOGIN_NO_SESSION', 'ไม่พบ session email');
        return { status: 'no_session' };
    }

    const user = _findUserByEmail(email);

    // กรณี email ไม่อยู่ใน auth_users
    if (!user) {
        logUserAction(email, '', 'LOGIN_DENIED', 'email ไม่พบในระบบ');
        return { status: 'denied', email: email };
    }

    // กรณีถูกระงับสิทธิ์
    if (user.status === 'suspended') {
        logUserAction(email, user.firstName + ' ' + user.lastName, 'LOGIN_SUSPENDED', 'บัญชีถูกระงับสิทธิ์');
        return { status: 'suspended', email: email };
    }

    // Login สำเร็จ → อัพเดท last_login
    try {
        const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
        const sheet = ss.getSheetByName(AUTH_SHEET);
        if (sheet) {
            const col = user._colMap || _getAuthColMapFresh();
            if (col.lastLogin !== undefined) {
                sheet.getRange(user.rowIdx, col.lastLogin + 1).setValue(new Date());
            }
        }
    } catch (e) { }

    logUserAction(email, user.firstName + ' ' + user.lastName, 'LOGIN_SUCCESS', 'Login สำเร็จ');

    return {
        status: 'ok',
        identity: {
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            position: user.position,
            hospital: user.hospital,
            phoneNo: user.phoneNo,
            role: user.role
        }
    };
}

/**
 * ตรวจสอบสิทธิ์ก่อนเขียนข้อมูล (internal helper)
 * @returns {object} user data จาก auth_users
 * @throws {Error} ถ้าไม่มีสิทธิ์
 */
function _requireAuth() {
    const email = Session.getActiveUser().getEmail();
    if (!email) throw new Error('กรุณาเข้าสู่ระบบก่อนดำเนินการ');
    const user = _findUserByEmail(email);
    if (!user) throw new Error('อีเมล ' + email + ' ไม่มีสิทธิ์ในระบบ');
    if (user.status !== 'active') throw new Error('บัญชีของท่านถูกระงับสิทธิ์');
    return user;
}

/**
 * ตรวจสอบสิทธิ์ Admin (internal helper)
 * @returns {object} user data
 * @throws {Error} ถ้าไม่ใช่ Admin
 */
function _requireAdmin() {
    const user = _requireAuth();
    if (user.role !== 'ADMIN') throw new Error('ฟังก์ชันนี้สำหรับผู้ดูแลระบบเท่านั้น');
    return user;
}

// ========================================
// LOG: บันทึก Log ทุก Event
// ========================================

/**
 * บันทึก Log การเข้าใช้งาน (auth_user_log)
 */
function logUserAction(email, fullName, action, detail) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('auth_user_log');
    if (sheet) {
      const timestamp = Utilities.formatDate(new Date(), "GMT+7", "dd/MM/yyyy HH:mm:ss");
      sheet.appendRow([timestamp, email, fullName, action, detail]);
    }
  } catch (e) { console.error("Log error: ", e); }
}

/**
 * บันทึก Transaction Log (t_eq_sp / t_sd / t_admin)
 * @param {string} sheetName - ชื่อ Sheet log
 * @param {array} rowData - array ของข้อมูล 1 แถว
 */
function _logTransaction(sheetName, rowData) {
    try {
        const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
        const sheet = ss.getSheetByName(sheetName);
        if (!sheet) return;
        sheet.appendRow(rowData);
    } catch (e) { }
}

// ========================================
// AUTH: อัพเดทข้อมูลผู้ใช้ (จาก Identity Modal)
// ========================================

/**
 * อัพเดทข้อมูลผู้ใช้ใน auth_users เมื่อแก้ไขผ่าน Identity Modal
 * @param {object} identity - { firstName, lastName, position, hospital, phoneNo }
 * @returns {object} { status }
 */
function updateUserIdentity(identity) {
    try {
        const email = Session.getActiveUser().getEmail();
        if (!email) return { status: 'error', message: 'ไม่พบ session' };

        const user = _findUserByEmail(email);
        if (!user) return { status: 'error', message: 'ไม่พบผู้ใช้' };

        // เช็คว่ามีการเปลี่ยนแปลงจริงไหม
        const changed = (
            identity.firstName !== user.firstName ||
            identity.lastName !== user.lastName ||
            identity.position !== user.position ||
            identity.hospital !== user.hospital ||
            identity.phoneNo !== user.phoneNo
        );
        if (!changed) return { status: 'ok', message: 'ไม่มีการเปลี่ยนแปลง' };

        const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
        const sheet = ss.getSheetByName(AUTH_SHEET);
        const row = user.rowIdx;
        const col = user._colMap || _getAuthColMapFresh();

        if (col.firstName !== undefined) sheet.getRange(row, col.firstName + 1).setValue(identity.firstName);
        if (col.lastName !== undefined) sheet.getRange(row, col.lastName + 1).setValue(identity.lastName);
        if (col.position !== undefined) sheet.getRange(row, col.position + 1).setValue(identity.position);
        if (col.hospital !== undefined) sheet.getRange(row, col.hospital + 1).setValue(identity.hospital);
        if (col.phoneNo !== undefined) sheet.getRange(row, col.phoneNo + 1).setValue(identity.phoneNo);

        _clearUserCache(email);
        return { status: 'ok' };
    } catch (e) {
        return { status: 'error', message: e.toString() };
    }
}

// ========================================
// DASHBOARD DATA (ไม่ต้อง auth — ดูได้ทุกคน)
// ========================================

function getDashboardData() {
    const cache = CacheService.getScriptCache();
    const bundleKey = `R8:${VERSION}:bundle`;

    function getBundledDataStr() {
        try {
            const chunkCountStr = cache.get(`${bundleKey}:count`);
            if (!chunkCountStr) return null;
            const numChunks = parseInt(chunkCountStr, 10);
            const keysToGet = [];
            for (let i = 0; i < numChunks; i++) keysToGet.push(`${bundleKey}:${i}`);
            const chunksObj = cache.getAll(keysToGet);
            let fullStr = '';
            for (let i = 0; i < numChunks; i++) {
                const part = chunksObj[`${bundleKey}:${i}`];
                if (!part) return null;
                fullStr += part;
            }
            return fullStr;
        } catch (e) {
            return null;
        }
    }

    const cachedStr = getBundledDataStr();
    if (cachedStr) return cachedStr;

    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
        const cachedStr2 = getBundledDataStr();
        if (cachedStr2) return cachedStr2;

        const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

        // Safe sheet reader — ป้องกัน null crash ถ้า sheet ไม่มี
        function safeRead(name, fallbackName) {
            let sh = ss.getSheetByName(name);
            if (!sh && fallbackName) sh = ss.getSheetByName(fallbackName);
            return sh ? sh.getDataRange().getValues() : [[]];
        }

        const hospital = safeRead('hospital');
        const population = safeRead('population');
        const sap = safeRead('sap_level');
        const medical = safeRead('medical');
        const bed = safeRead('bed');
        const hospital_structure = safeRead('hospital_structure');
        const meqsp = safeRead('m_eq_sp');
        const msp = safeRead('c_sp', 'm_sp'); // รองรับทั้งชื่อใหม่ c_sp และชื่อเก่า m_sp

        const meqmophSheet = ss.getSheetByName('m_eq_moph');
        const meqmophRaw = meqmophSheet ? meqmophSheet.getDataRange().getValues() : [[]];
        const meqmoph = meqmophRaw.map(r => r.length > 6 ? [null, null, null, r[3], r[4], null, r[6]] : r);

        const msd = safeRead('m_sd');
        const cspsd = safeRead('c_sp_sd');
        const csdcriteria = safeRead('c_sd_criteria');
        const csdmethod = safeRead('c_sd_method');

        let lastUpdatedISO = new Date().toISOString();
        try { lastUpdatedISO = DriveApp.getFileById(SPREADSHEET_ID).getLastUpdated().toISOString(); } catch (e) { }

        const payload = {
            status: 'success',
            data: { hospital, population, sap, medical, bed, hospital_structure, meqsp, msp, meqmoph, msd, cspsd, csdcriteria, csdmethod },
            meta: { version: VERSION, lastUpdated: lastUpdatedISO }
        };

        const payloadStr = JSON.stringify(payload);

        try {
            const chunkSize = 40000;
            const numChunks = Math.ceil(payloadStr.length / chunkSize);
            const toCache = {};
            toCache[`${bundleKey}:count`] = numChunks.toString();
            for (let i = 0; i < numChunks; i++) {
                toCache[`${bundleKey}:${i}`] = payloadStr.substring(i * chunkSize, (i + 1) * chunkSize);
            }
            cache.putAll(toCache, CACHE_TTL_SEC);
        } catch (e) { }

        return payloadStr;

    } catch (error) {
        return JSON.stringify({ status: 'error', message: error.toString() });
    } finally {
        lock.releaseLock();
    }
}

function clearDashboardCache() {
    const cache = CacheService.getScriptCache();
    cache.remove(`R8:${VERSION}:bundle:count`);
    return { status: 'success' };
}

// ========================================
// EQUIPMENT: เพิ่ม/แก้ไขครุภัณฑ์ (ต้อง auth + identity confirm)
// ========================================

/**
 * เพิ่มรายการครุภัณฑ์ใหม่
 * @param {object} record - ข้อมูลครุภัณฑ์
 * @param {object} identity - { firstName, lastName, position, hospital, phoneNo }
 */
function addEquipmentRecord(record, identity) {
    const user = _requireAuth();
    _validateIdentity(identity);

    const lock = LockService.getScriptLock();
    try {
        lock.waitLock(10000);
        const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
        const sheet = ss.getSheetByName('m_eq_sp');
        sheet.appendRow([
            record.year, record.sp, record.prov, record.hosp, record.item,
            record.price, record.qty, record.amt, record.fundSrc,
            record.itemCode, record.priority, record.provPriority,
            new Date() // timestamp col 13
        ]);

        clearDashboardCacheInternal_();

        // Transaction log
        const snapshot = JSON.stringify(record);
        _logTransaction(T_EQ_SHEET, [
            new Date(), user.email,
            identity.firstName + ' ' + identity.lastName,
            identity.position, identity.hospital, identity.phoneNo,
            'ADD', '', record.sp || '', record.hosp || '',
            record.item || '', record.qty || 0, record.amt || 0, snapshot
        ]);

        // อัพเดท identity ถ้ามีการเปลี่ยนแปลง
        _syncIdentityIfChanged(user, identity);

        return { status: 'success' };
    } catch (e) {
        return { status: 'error', message: e.toString() };
    } finally {
        lock.releaseLock();
    }
}

/**
 * แก้ไขรายการครุภัณฑ์
 * @param {object} record - ข้อมูลครุภัณฑ์ (รวม rowIdx)
 * @param {object} identity - { firstName, lastName, position, hospital, phoneNo }
 */
function editEquipmentRecord(record, identity) {
    const user = _requireAuth();
    _validateIdentity(identity);

    const lock = LockService.getScriptLock();
    try {
        lock.waitLock(10000);
        const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
        const sheet = ss.getSheetByName('m_eq_sp');
        const rowIdx = parseInt(record.rowIdx, 10);
        if (!rowIdx || rowIdx < 2) throw new Error("Invalid Row Index");

        // เก็บข้อมูลเดิม (snapshot)
        const oldData = sheet.getRange(rowIdx, 1, 1, 13).getValues()[0];
        const oldSnapshot = JSON.stringify({
            year: oldData[0], sp: oldData[1], prov: oldData[2], hosp: oldData[3],
            item: oldData[4], price: oldData[5], qty: oldData[6], amt: oldData[7],
            fundSrc: oldData[8], itemCode: oldData[9], priority: oldData[10], provPriority: oldData[11]
        });

        const range = sheet.getRange(rowIdx, 1, 1, 13);
        range.setValues([[
            record.year, record.sp, record.prov, record.hosp, record.item,
            record.price, record.qty, record.amt, record.fundSrc,
            record.itemCode, record.priority, record.provPriority,
            new Date() // timestamp col 13
        ]]);

        clearDashboardCacheInternal_();

        // Transaction log (เก็บทั้ง old + new)
        const snapshot = JSON.stringify({ old: JSON.parse(oldSnapshot), new: record });
        _logTransaction(T_EQ_SHEET, [
            new Date(), user.email,
            identity.firstName + ' ' + identity.lastName,
            identity.position, identity.hospital, identity.phoneNo,
            'EDIT', rowIdx, record.sp || '', record.hosp || '',
            record.item || '', record.qty || 0, record.amt || 0, snapshot
        ]);

        _syncIdentityIfChanged(user, identity);
        return { status: 'success' };
    } catch (e) {
        return { status: 'error', message: e.toString() };
    } finally {
        lock.releaseLock();
    }
}

// ========================================
// SERVICE DELIVERY: ประเมิน SD (ต้อง auth + identity confirm)
// ========================================

/**
 * Batch upsert Service Delivery records
 * @param {array} records - [{hosp_name, sd_code, value}, ...]
 * @param {object} identity - { firstName, lastName, position, hospital, phoneNo }
 */
function batchEditSdRecords(records, identity) {
    const user = _requireAuth();
    _validateIdentity(identity);

    const lock = LockService.getScriptLock();
    try {
        lock.waitLock(15000);
        const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
        const sheet = ss.getSheetByName('m_sd');
        const data = sheet.getDataRange().getValues();
        const headers = data[0].map(h => String(h || '').trim());

        const hospCol = headers.findIndex(h => h.includes('โรงพยาบาล') || h.includes('ชื่อ'));
        if (hospCol === -1) throw new Error('ไม่พบคอลัมน์ชื่อโรงพยาบาลใน m_sd');

        const spCol = headers.findIndex(h => h.includes('สาขา'));

        const rowMap = {};
        for (let i = 1; i < data.length; i++) {
            const name = String(data[i][hospCol] || '').trim();
            if (name) rowMap[name] = { rowNum: i + 1, rowData: data[i] };
        }

        const colMap = {};
        headers.forEach((h, i) => { colMap[h] = i + 1; });

        // เก็บ changes detail สำหรับ log
        const changes = [];
        let hospTarget = '';
        let spBranch = '';

        records.forEach(r => {
            const hospName = String(r.hosp_name).trim();
            const sdCode = String(r.sd_code).trim();
            const rowInfo = rowMap[hospName];
            const colNum = colMap[sdCode];

            if (rowInfo && colNum) {
                // เก็บค่าเดิม
                const oldVal = String(rowInfo.rowData[colNum - 1] ?? '').trim();
                const newVal = String(r.value ?? '').trim();

                sheet.getRange(rowInfo.rowNum, colNum).setValue(r.value);

                if (sdCode !== 'SD_remark' && sdCode !== 'หมายเหตุ') {
                    changes.push({ code: sdCode, old: oldVal, new: newVal });
                }

                if (!hospTarget) hospTarget = hospName;
                if (!spBranch && spCol > -1) spBranch = String(rowInfo.rowData[spCol] || '').trim();
            }
        });

        clearDashboardCacheInternal_();

        // Transaction log
        const changesDetail = changes.map(c => c.code + ':' + c.old + '→' + c.new).join(', ');
        const snapshot = JSON.stringify(changes);
        _logTransaction(T_SD_SHEET, [
            new Date(), user.email,
            identity.firstName + ' ' + identity.lastName,
            identity.position, identity.hospital, identity.phoneNo,
            hospTarget, spBranch, changes.length, changesDetail, snapshot
        ]);

        _syncIdentityIfChanged(user, identity);
        return { status: 'success', updated: records.length };
    } catch (e) {
        return { status: 'error', message: e.toString() };
    } finally {
        lock.releaseLock();
    }
}

// ========================================
// ADMIN: จัดการผู้ใช้
// ========================================

/**
 * ดึงรายชื่อ user ทั้งหมด (เฉพาะ Admin)
 */
function getUserList() {
    _requireAdmin();
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(AUTH_SHEET);
    if (!sheet) return { status: 'error', message: 'ไม่พบ Sheet ' + AUTH_SHEET };

    const data = sheet.getDataRange().getValues();
    if (data.length < 1) return { status: 'success', users: [] };

    const col = _getAuthColMap(data[0]);
    if (col.email === undefined) return { status: 'error', message: 'ไม่พบคอลัมน์ email ใน ' + AUTH_SHEET };

    const users = [];
    for (let i = 1; i < data.length; i++) {
        const emailVal = col.email !== undefined ? String(data[i][col.email] || '').trim() : '';
        if (!emailVal) continue;
        users.push({
            rowIdx: i + 1,
            email: emailVal,
            firstName: col.firstName !== undefined ? String(data[i][col.firstName] || '').trim() : '',
            lastName: col.lastName !== undefined ? String(data[i][col.lastName] || '').trim() : '',
            position: col.position !== undefined ? String(data[i][col.position] || '').trim() : '',
            hospital: col.hospital !== undefined ? String(data[i][col.hospital] || '').trim() : '',
            phoneNo: col.phoneNo !== undefined ? String(data[i][col.phoneNo] || '').trim() : '',
            role: col.role !== undefined ? String(data[i][col.role] || 'USER').trim() : 'USER',
            status: col.status !== undefined ? String(data[i][col.status] || 'active').trim() : 'active',
            createdBy: col.createdBy !== undefined ? String(data[i][col.createdBy] || '').trim() : '',
            createdAt: col.createdAt !== undefined ? data[i][col.createdAt] || '' : '',
            lastLogin: col.lastLogin !== undefined ? data[i][col.lastLogin] || '' : ''
        });
    }
    return { status: 'success', users: users };
}

/**
 * เพิ่มผู้ใช้ใหม่ (เฉพาะ Admin)
 * @param {object} userData - { email, firstName, lastName, position, hospital, phoneNo, role }
 */
function addUser(userData) {
    const admin = _requireAdmin();

    // Validate
    if (!userData.email || !userData.firstName || !userData.lastName || !userData.hospital) {
        return { status: 'error', message: 'กรุณากรอกข้อมูลให้ครบ (email, ชื่อ, นามสกุล, รพ.)' };
    }

    // เช็ค email ซ้ำ
    const existing = _findUserByEmail(userData.email);
    if (existing) {
        return { status: 'error', message: 'อีเมล ' + userData.email + ' มีอยู่ในระบบแล้ว' };
    }

    const lock = LockService.getScriptLock();
    try {
        lock.waitLock(10000);
        const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
        const sheet = ss.getSheetByName(AUTH_SHEET);
        const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
        const col = _getAuthColMap(headers);
        const role = (userData.role === 'ADMIN') ? 'ADMIN' : 'USER';

        const newRow = new Array(headers.length).fill('');
        if (col.email !== undefined) newRow[col.email] = userData.email.trim().toLowerCase();
        if (col.firstName !== undefined) newRow[col.firstName] = userData.firstName.trim();
        if (col.lastName !== undefined) newRow[col.lastName] = userData.lastName.trim();
        if (col.position !== undefined) newRow[col.position] = (userData.position || '').trim();
        if (col.hospital !== undefined) newRow[col.hospital] = userData.hospital.trim();
        if (col.phoneNo !== undefined) newRow[col.phoneNo] = (userData.phoneNo || '').trim();
        if (col.role !== undefined) newRow[col.role] = role;
        if (col.status !== undefined) newRow[col.status] = 'active';
        if (col.createdBy !== undefined) newRow[col.createdBy] = admin.email;
        if (col.createdAt !== undefined) newRow[col.createdAt] = new Date();

        sheet.appendRow(newRow);

        _clearUserCache(userData.email);

        // Transaction log
        _logTransaction(T_ADMIN_SHEET, [
            new Date(), admin.email,
            admin.firstName + ' ' + admin.lastName,
            'ADD_USER', userData.email,
            userData.firstName + ' ' + userData.lastName,
            'เพิ่มผู้ใช้ใหม่ role=' + role + ' hospital=' + userData.hospital
        ]);

        return { status: 'success' };
    } catch (e) {
        return { status: 'error', message: e.toString() };
    } finally {
        lock.releaseLock();
    }
}

/**
 * แก้ไขข้อมูล user (เฉพาะ Admin)
 * @param {object} userData - { email, firstName, lastName, position, hospital, phoneNo, role }
 */
function editUser(userData) {
    const admin = _requireAdmin();

    if (!userData.email) return { status: 'error', message: 'ไม่ระบุ email' };

    const user = _findUserByEmail(userData.email);
    if (!user) return { status: 'error', message: 'ไม่พบผู้ใช้ ' + userData.email };

    const lock = LockService.getScriptLock();
    try {
        lock.waitLock(10000);
        const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
        const sheet = ss.getSheetByName(AUTH_SHEET);
        const row = user.rowIdx;
        const col = user._colMap || _getAuthColMapFresh();

        const oldInfo = user.firstName + ' ' + user.lastName + ' / ' + user.position + ' / ' + user.hospital;

        if (userData.firstName && col.firstName !== undefined) sheet.getRange(row, col.firstName + 1).setValue(userData.firstName.trim());
        if (userData.lastName && col.lastName !== undefined) sheet.getRange(row, col.lastName + 1).setValue(userData.lastName.trim());
        if (userData.position !== undefined && col.position !== undefined) sheet.getRange(row, col.position + 1).setValue((userData.position || '').trim());
        if (userData.hospital && col.hospital !== undefined) sheet.getRange(row, col.hospital + 1).setValue(userData.hospital.trim());
        if (userData.phoneNo !== undefined && col.phoneNo !== undefined) sheet.getRange(row, col.phoneNo + 1).setValue((userData.phoneNo || '').trim());
        if (userData.role && col.role !== undefined) sheet.getRange(row, col.role + 1).setValue(userData.role === 'ADMIN' ? 'ADMIN' : 'USER');

        _clearUserCache(userData.email);

        const newInfo = (userData.firstName || user.firstName) + ' ' + (userData.lastName || user.lastName) + ' / ' + (userData.position || user.position) + ' / ' + (userData.hospital || user.hospital);

        _logTransaction(T_ADMIN_SHEET, [
            new Date(), admin.email,
            admin.firstName + ' ' + admin.lastName,
            'EDIT_USER', userData.email,
            (userData.firstName || user.firstName) + ' ' + (userData.lastName || user.lastName),
            'แก้ไขข้อมูล: [เดิม] ' + oldInfo + ' → [ใหม่] ' + newInfo
        ]);

        return { status: 'success' };
    } catch (e) {
        return { status: 'error', message: e.toString() };
    } finally {
        lock.releaseLock();
    }
}

/**
 * ระงับ/เปิดสิทธิ์ user (เฉพาะ Admin)
 * @param {string} targetEmail
 * @returns {object} { status, newStatus }
 */
function toggleUserStatus(targetEmail) {
    const admin = _requireAdmin();

    if (!targetEmail) return { status: 'error', message: 'ไม่ระบุ email' };

    // ป้องกัน Admin ระงับตัวเอง
    if (targetEmail.toLowerCase().trim() === admin.email.toLowerCase().trim()) {
        return { status: 'error', message: 'ไม่สามารถระงับสิทธิ์ตัวเองได้' };
    }

    const user = _findUserByEmail(targetEmail);
    if (!user) return { status: 'error', message: 'ไม่พบผู้ใช้ ' + targetEmail };

    const lock = LockService.getScriptLock();
    try {
        lock.waitLock(10000);
        const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
        const sheet = ss.getSheetByName(AUTH_SHEET);

        const newStatus = (user.status === 'active') ? 'suspended' : 'active';
        const col = user._colMap || _getAuthColMapFresh();
        if (col.status !== undefined) {
            sheet.getRange(user.rowIdx, col.status + 1).setValue(newStatus);
        }

        _clearUserCache(targetEmail);

        const action = (newStatus === 'suspended') ? 'SUSPEND_USER' : 'REACTIVATE_USER';
        _logTransaction(T_ADMIN_SHEET, [
            new Date(), admin.email,
            admin.firstName + ' ' + admin.lastName,
            action, targetEmail,
            user.firstName + ' ' + user.lastName,
            'เปลี่ยนสถานะ: ' + user.status + '→' + newStatus
        ]);

        return { status: 'success', newStatus: newStatus };
    } catch (e) {
        return { status: 'error', message: e.toString() };
    } finally {
        lock.releaseLock();
    }
}

// ========================================
// HELPERS (Internal)
// ========================================

/**
 * Validate identity object
 */
function _validateIdentity(identity) {
    if (!identity) throw new Error('ไม่พบข้อมูลผู้ให้ข้อมูล');
    if (!identity.firstName || !identity.lastName) throw new Error('กรุณาระบุชื่อ-นามสกุลผู้ให้ข้อมูล');
    if (!identity.hospital) throw new Error('กรุณาระบุสังกัดโรงพยาบาล');
}

/**
 * ล้าง Dashboard Cache (internal — ไม่เช็ค admin)
 */
function clearDashboardCacheInternal_() {
    try {
        const cache = CacheService.getScriptCache();
        cache.remove(`R8:${VERSION}:bundle:count`);
    } catch (e) { }
}

/**
 * Sync identity ถ้ามีการเปลี่ยนแปลงจาก Modal
 */
function _syncIdentityIfChanged(user, identity) {
    try {
        const changed = (
            identity.firstName !== user.firstName ||
            identity.lastName !== user.lastName ||
            identity.position !== user.position ||
            identity.hospital !== user.hospital ||
            identity.phoneNo !== user.phoneNo
        );
        if (changed) {
            updateUserIdentity(identity);
        }
    } catch (e) { }
}

// ========================================
// SAP EVALUATION: ประเมินระดับ SAP (S, S+, A, P ฯลฯ)
// ========================================

/**
 * รับข้อมูลจากหน้าเว็บและบันทึกลง Sheet: t_sap_level
 * @param {object} payload - ข้อมูลการประเมิน { target_level, eval_year, scores: {s1, s2, s3, s4, total}, result, status, raw_data }
 * @param {object} identity - { firstName, lastName, position, hospital, province, phoneNo }
 */
function submitSapEvaluation(payload, identity) {
    const user = _requireAuth(); // เช็คสิทธิ์ (ต้อง Login)
    _validateIdentity(identity); // เช็คว่ากรอกชื่อ รพ. หรือยัง

    const lock = LockService.getScriptLock();
    try {
        lock.waitLock(10000); // ป้องกันคนกดส่งพร้อมกัน
        const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
        
        // ค้นหา Sheet t_sap_level ถ้าไม่มีให้สร้างใหม่พร้อม Header
        let sheet = ss.getSheetByName('t_sap_level');
        if (!sheet) {
            sheet = ss.insertSheet('t_sap_level');
            sheet.appendRow([
                'timestamp', 'email', 'evaluator_name', 'hospital_name', 'province',
                'eval_year', 'target_level', 'score_s1', 'score_s2', 'score_s3',
                'score_s4', 'total_score', 'eval_result', 'status', 'eval_data_json'
            ]);
            // ล็อกแถวแรกที่เป็น Header
            sheet.setFrozenRows(1);
        }

        const fullName = identity.firstName + ' ' + identity.lastName;
        const province = identity.province || 'ไม่ระบุ'; // ระบบเดิมอาจจะไม่มี province ให้รับมาเพิ่มเติม

        // แปลงข้อมูลดิบจากฟอร์ม (raw_data) ให้เป็น JSON String
        const evalDataJson = JSON.stringify(payload.raw_data || {});

        // เตรียมข้อมูล 1 แถวเพื่อบันทึกลงชีตตามโครงสร้างที่ตกลงกันไว้
        const rowData = [
            new Date(),                     // A: timestamp
            user.email,                     // B: email
            fullName,                       // C: evaluator_name
            identity.hospital,              // D: hospital_name
            province,                       // E: province
            payload.eval_year || '',        // F: eval_year (เช่น 2568)
            payload.target_level || 'S',    // G: target_level
            payload.scores.s1 || 0,         // H: score_s1
            payload.scores.s2 || 0,         // I: score_s2
            payload.scores.s3 || 0,         // J: score_s3
            payload.scores.s4 || 0,         // K: score_s4
            payload.scores.total || 0,      // L: total_score
            payload.result || 'ยังไม่ผ่าน',   // M: eval_result
            payload.status || 'Submitted',  // N: status
            evalDataJson                    // O: eval_data_json
        ];

        // บันทึกลง Sheet
        sheet.appendRow(rowData);

        // บันทึกประวัติการกระทำลงใน Log (เพื่อให้ Admin ตรวจสอบได้)
        _logTransaction(T_ADMIN_SHEET, [
            new Date(), user.email, fullName,
            'SUBMIT_SAP_EVAL', payload.target_level, identity.hospital,
            'ประเมินระดับ ' + payload.target_level + ' ได้คะแนน: ' + payload.scores.total
        ]);

        // อัพเดทข้อมูลผู้ใช้เบื้องหลัง (ถ้าผู้ใช้มีการเปลี่ยนชื่อหรือเบอร์โทรในฟอร์ม)
        _syncIdentityIfChanged(user, identity);

        return { status: 'success', message: 'บันทึกข้อมูลสำเร็จ' };

    } catch (e) {
        return { status: 'error', message: e.toString() };
    } finally {
        lock.releaseLock();
    }
}

// ==========================================
// 🟢 ระบบ Authentication & Security Log
// ==========================================

function logUserAction(email, fullName, action, detail) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('auth_user_log');
    if (sheet) {
      // คอลัมน์ A=timestamp, B=email, C=full_name, D=action, E=detail
      const timestamp = Utilities.formatDate(new Date(), "GMT+7", "dd/MM/yyyy HH:mm:ss");
      sheet.appendRow([timestamp, email, fullName, action, detail]);
    }
  } catch (e) {
    console.error("Log error: ", e);
  }
}

function verifyUserLogin(email) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('auth_users');
    const data = sheet.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      const row = data[i]; // A=0:email, B=1:fname, C=2:lname, D=3:pos, E=4:hosp, F=5:role, G=6:status
      if (String(row[0]).trim().toLowerCase() === email.trim().toLowerCase()) {
        if (String(row[6]).trim().toLowerCase() === 'active') {
          const userObj = {
            email: row[0],
            full_name: row[1] + " " + row[2],
            hospital: row[4],
            role: String(row[5]).trim().toLowerCase()
          };
          logUserAction(userObj.email, userObj.full_name, 'LOGIN_SUCCESS', 'เข้าสู่ระบบ (Email Login)');
          return { success: true, user: userObj };
        }
        return { success: false, message: 'บัญชีนี้ถูกระงับการใช้งาน' };
      }
    }
    logUserAction(email, 'Unknown', 'LOGIN_FAILED', 'พยายามเข้าสู่ระบบด้วย Email ที่ไม่มีในระบบ');
    return { success: false, message: 'ไม่พบ Email นี้ในระบบ' };
  } catch (e) { return { success: false, message: 'Error: ' + e.toString() }; }
}

function handleUserLogout(email, fullName) {
  logUserAction(email, fullName, 'LOGOUT', 'ออกจากระบบ');
  return true;
}
