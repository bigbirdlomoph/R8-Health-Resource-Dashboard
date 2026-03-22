*** ระบบบริหารจัดการทรัพยากรสุขภาพ เขตสุขภาพที่ 8 กระทรวงสาธารณสุข : (R8HR : R8 Health Resource)***

## Technology
- GAS : Google App Scripts
- TailwindCss
- Theme โทน ขาว เขียว กระทรวงสาธารณสุข

# Feature
**1. ระบบจัดการฐานข้อมูลและสถาปัตยกรรม (Core & Architecture)**
* ใช้ Google Apps Script เป็น Backend เชื่อมต่อดึงข้อมูลจาก Google Sheets หลายชีต (hospital, population, sap_level, medical, bed, hospital_structure, m_eq_sp)
* มีระบบ Cache ข้อมูลแบบ Chunking (แบ่งข้อมูลเป็นก้อนละ 40,000 ตัวอักษร) เพื่อแก้ปัญหาข้อจำกัดของ Google และป้องกันอาการโหลดค้าง (Infinite Loading)
* ใช้ระบบ `LockService` ควบคุมการทำงานพร้อมกัน (Concurrency) เพื่อป้องกันข้อมูลสูญหายหรือทับซ้อนเวลาบันทึกข้อมูล

**2. โครงสร้างระบบผู้ใช้งาน (Auth & Logging)**
* มีการวางโครงสร้างตัวแปรเพื่อรองรับระบบสิทธิ์การเข้าถึง (Authentication) เช่น การแบ่งชีต `auth_users` และ `t_admin`
* มีการวางโครงสร้างระบบ Transaction Log (`auth_user_log`) สำหรับบันทึกประวัติการใช้งานและตรวจสอบการเปลี่ยนแปลงข้อมูลต่างๆ

**3. แดชบอร์ดภาพรวมทรัพยากร (Main Dashboard)**
* **KPI Cards (ภาพรวม):** แสดงตัวเลขสรุปที่สำคัญ ได้แก่ จำนวนโรงพยาบาลรวม, ประชากรรวม, แพทย์สาขาหลักรวม, และเตียงจริงทั้งหมด
* **การ์ดสรุปโซน:** แสดงจำนวนโรงพยาบาลแยกตามโซน (Zone 8.1, 8.2, 8.3)
* **Interactive Charts (กราฟประมวลผล):** มีกราฟแท่งแสดงข้อมูลประชากรรายจังหวัดและอำเภอ, จำนวนแพทย์แยกตามสาขาหลัก, กราฟเปรียบเทียบประเภทโรงพยาบาล (รพศ./รพท./รพช.), และกราฟระดับศักยภาพ SAP
* **Data Tables (ตารางข้อมูล):** มีตารางแสดงผลข้อมูล 4 หมวดหลัก ได้แก่ สรุปจำนวนเตียง, โครงสร้างและเครื่องมือแพทย์สำคัญ, แพทย์สาขาหลัก, และพยาบาลเฉพาะทาง

**4. ระบบจัดการครุภัณฑ์ Service Plan (EQ Module)**
* มีตารางแสดงรายการครุภัณฑ์ทั้งหมด สามารถค้นหาและกรองข้อมูลตาม ปีงบประมาณ, จังหวัด, และ สาขา SP ได้
* มี Summary Cards สรุปด้านบนเพื่อแสดง: จำนวนครุภัณฑ์ (รายการ), จำนวนหน่วย (ชิ้น), และ วงเงินรวม (บาท) แบบเรียลไทม์ตามตัวกรอง
* มีระบบ Modal สำหรับการ เพิ่ม (Add) และ แก้ไข (Edit) รายการครุภัณฑ์ พร้อมระบบคำนวณวงเงินอัตโนมัติ (ราคาต่อหน่วย x จำนวน)

**5. ระบบแผนที่ภูมิสารสนเทศ (GIS Mapping Module)**
* ใช้เทคโนโลยี Leaflet.js ร่วมกับ GeoJSON ในการแสดงผลแผนที่แบบ Interactive (Heatmap)
* **แบ่งแผนที่ออกเป็น 4 แท็บย่อย:**
    * **GIS ครุภัณฑ์ SP:** แสดงแผนที่ความหนาแน่นของวงเงินครุภัณฑ์
    * **GIS เตียง:** แสดงแผนที่ความหนาแน่นของเตียงผู้ป่วย พร้อม Summary Cards สรุปแยก 5 ประเภทหลัก (NICU, OR, ICU, Stroke, HD) และเตียงกรอบ/เตียงจริง
    * **GIS แพทย์:** แสดงแผนที่ความหนาแน่นของแพทย์ พร้อม Summary Cards สรุปแยกรายสาขา (กุมารแพทย์, ศัลยแพทย์ OR, ทันตแพทย์, เภสัชกร ฯลฯ)
    * **GIS พยาบาล:** แสดงแผนที่ความหนาแน่นของพยาบาลเฉพาะทาง พร้อม Summary Cards สรุปแยก 5 สาขา (NICU, OR, ICU, Stroke, HD)
* **ตัวกรองแผนที่ (Map Filters):** ทุกหน้าแผนที่มีระบบ Dropdown สำหรับเลือกดู "ภาพรวมทั้งเขต (ทุกจังหวัด)" หรือ "เจาะลึกระดับรายอำเภอ (เลือกรายจังหวัด)" พร้อมตัวกรองแยกตามประเภทบุคลากร/เตียง

**6. User Interface & User Experience (UI/UX)**
* ใช้ Tailwind CSS ในการออกแบบหน้าตาให้ดูทันสมัย เป็น Responsive Design (รองรับมือถือและเดสก์ท็อป)
* มี Sidebar Navigation (แถบเมนูด้านซ้าย) แบบซ่อน/กาง ได้
* มี Loading Overlay (ฉากโหลด) และระบบ Toast Notification (แจ้งเตือนสถานะมุมขวาบน) เมื่อมีการบันทึกหรือรีเฟรชข้อมูล

# R8-Health-Resource-Dashboard Version: 69030-1025
<img width="1870" height="4173" alt="image" src="https://github.com/user-attachments/assets/af8fbf26-1d70-4391-bc58-0704458fb8da" />

# R8-Health-Resource-Dashboard Version: 690227-1130
<img width="1846" height="4406" alt="image" src="https://github.com/user-attachments/assets/1b01a53c-6130-4c09-b043-92ab956fccb2" />

# Equipment Service Plan
<img width="1857" height="1780" alt="image" src="https://github.com/user-attachments/assets/ff4e5ab5-2400-4815-9de1-dddf3d8066b3" />

# Geo Map
<img width="1855" height="1671" alt="image" src="https://github.com/user-attachments/assets/289d3301-81ca-49de-98c4-bcb91b039eb1" />


# R8-Health-Resource-Dashboard Version: 690120-0842
<img width="1853" height="3976" alt="image" src="https://github.com/user-attachments/assets/cb2f5457-d8cd-4d97-97e7-0a9149c7eaa1" />



# R8-Health-Resource-Dashboard Version: 690115-1333
<img width="1876" height="4224" alt="image" src="https://github.com/user-attachments/assets/a5beb7c4-22a9-4bed-9d73-d46e42fe81d7" />

