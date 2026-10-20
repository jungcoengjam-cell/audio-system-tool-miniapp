// Static control-operation frames transcribed from the supplied manual.
// Reads remain in the source DOCX; this reference contains writes only.
// Copy-only: it never connects to or sends data to a device.
const formalManual = {
  "title": "SmartPLC-F300 控制卡操作参考",
  "statusLabel": "用户确认该现场样本协议已验证",
  "sourceTitle": "QN-PLC（全球款）配电柜说明书",
  "manualVersion": "202511 V1.0",
  "protocolVersionLabel": "手册未标注协议版本",
  "sourceSha256": "3DEF2C2A5844F3D2D1424DE76B2BD77A6FFD13E6FD5322E9DF7F8F859CD0F6E4",
  "applicabilityNote": "用户确认这台 itC KZX 机柜内 SmartPLC-F300 样本所用协议已验证且准确；此参考仅对应该现场样本，不能外推至其他 F300 控制卡或机柜。柜内卡品牌、硬件/固件版本和协议版本未知。",
  "safetyNote": "供现场人员核对后人工选择参考；这里只把手册请求帧复制到剪贴板，不连接或发送设备。",
  "versionNote": "202511 V1.0 是说明书版本，不是设备固件版本或通信协议版本。",
  "transports": [
    {
      "id": "tcp",
      "name": "MODBUS-TCP",
      "parameters": "默认 IP 192.168.1.200 · 端口 502",
      "note": "手册示例帧中的 Unit ID 为 0x32（50）；请先确认现场网络与设备设置。",
      "commands": [
        {
          "id": "tcp-write-01",
          "label": "一键启动",
          "sourceLabel": "一键启动",
          "frame": "00 00 00 00 00 06 32 05 03 E8 FF 00",
          "sourceParagraph": 140,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-02",
          "label": "一键停止",
          "sourceLabel": "一键停止",
          "frame": "00 00 00 00 00 06 32 05 03 E9 FF 00",
          "sourceParagraph": 141,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-03",
          "label": "急停按下",
          "sourceLabel": "急停按下",
          "frame": "00 00 00 00 00 06 32 05 03 EA FF 00",
          "sourceParagraph": 142,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-04",
          "label": "急停取消",
          "sourceLabel": "急停取消",
          "frame": "00 00 00 00 00 06 32 05 03 EA 00 00",
          "sourceParagraph": 143,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-05",
          "label": "第1路启动",
          "sourceLabel": "第1路启动",
          "frame": "00 00 00 00 00 06 32 05 03 EB FF 00",
          "sourceParagraph": 144,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-06",
          "label": "第1路关闭",
          "sourceLabel": "第1路关闭",
          "frame": "00 00 00 00 00 06 32 05 03 EC FF 00",
          "sourceParagraph": 145,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-07",
          "label": "第2路启动",
          "sourceLabel": "第2路启动",
          "frame": "00 00 00 00 00 06 32 05 03 ED FF 00",
          "sourceParagraph": 146,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-08",
          "label": "第2路关闭",
          "sourceLabel": "第2路关闭",
          "frame": "00 00 00 00 00 06 32 05 03 EE FF 00",
          "sourceParagraph": 147,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-09",
          "label": "第3路启动",
          "sourceLabel": "第3路启动",
          "frame": "00 00 00 00 00 06 32 05 03 EF FF 00",
          "sourceParagraph": 148,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-10",
          "label": "第3路关闭",
          "sourceLabel": "第3路关闭",
          "frame": "00 00 00 00 00 06 32 05 03 F0 FF 00",
          "sourceParagraph": 149,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-11",
          "label": "第4路启动",
          "sourceLabel": "第4路启动",
          "frame": "00 00 00 00 00 06 32 05 03 F1 FF 00",
          "sourceParagraph": 150,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-12",
          "label": "第4路关闭",
          "sourceLabel": "第4路关闭",
          "frame": "00 00 00 00 00 06 32 05 03 F2 FF 00",
          "sourceParagraph": 151,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-13",
          "label": "第5路启动",
          "sourceLabel": "第5路启动",
          "frame": "00 00 00 00 00 06 32 05 03 F3 FF 00",
          "sourceParagraph": 152,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-14",
          "label": "第5路关闭",
          "sourceLabel": "第5路关闭",
          "frame": "00 00 00 00 00 06 32 05 03 F4 FF 00",
          "sourceParagraph": 153,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-15",
          "label": "第6路启动",
          "sourceLabel": "第6路启动",
          "frame": "00 00 00 00 00 06 32 05 03 F5 FF 00",
          "sourceParagraph": 154,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-16",
          "label": "第6路关闭",
          "sourceLabel": "第6路关闭",
          "frame": "00 00 00 00 00 06 32 05 03 F6 FF 00",
          "sourceParagraph": 155,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-17",
          "label": "第7路启动",
          "sourceLabel": "第7路启动",
          "frame": "00 00 00 00 00 06 32 05 03 F7 FF 00",
          "sourceParagraph": 156,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-18",
          "label": "第7路关闭",
          "sourceLabel": "第7路关闭",
          "frame": "00 00 00 00 00 06 32 05 03 F8 FF 00",
          "sourceParagraph": 157,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-19",
          "label": "第8路启动",
          "sourceLabel": "第8路启动",
          "frame": "00 00 00 00 00 06 32 05 03 F9 FF 00",
          "sourceParagraph": 158,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-20",
          "label": "第8路关闭",
          "sourceLabel": "第8路关闭",
          "frame": "00 00 00 00 00 06 32 05 03 FA FF 00",
          "sourceParagraph": 159,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-21",
          "label": "第9路启动",
          "sourceLabel": "第9路启动",
          "frame": "00 00 00 00 00 06 32 05 03 FB FF 00",
          "sourceParagraph": 161,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-22",
          "label": "第9路关闭",
          "sourceLabel": "第9路关闭",
          "frame": "00 00 00 00 00 06 32 05 03 FC FF 00",
          "sourceParagraph": 162,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-23",
          "label": "第10路启动",
          "sourceLabel": "第10路启动",
          "frame": "00 00 00 00 00 06 32 05 03 FD FF 00",
          "sourceParagraph": 163,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-24",
          "label": "第10路关闭",
          "sourceLabel": "第10路关闭",
          "frame": "00 00 00 00 00 06 32 05 03 FE FF 00",
          "sourceParagraph": 164,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-25",
          "label": "第11路启动",
          "sourceLabel": "第11路启动",
          "frame": "00 00 00 00 00 06 32 05 03 FF FF 00",
          "sourceParagraph": 165,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-26",
          "label": "第11路关闭",
          "sourceLabel": "第11路关闭",
          "frame": "00 00 00 00 00 06 32 05 04 00 FF 00",
          "sourceParagraph": 166,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-27",
          "label": "第12路启动",
          "sourceLabel": "第12路启动",
          "frame": "00 00 00 00 00 06 32 05 04 01 FF 00",
          "sourceParagraph": 167,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-28",
          "label": "第12路关闭",
          "sourceLabel": "第12路关闭",
          "frame": "00 00 00 00 00 06 32 05 04 02 FF 00",
          "sourceParagraph": 168,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-29",
          "label": "第13路启动",
          "sourceLabel": "第13路启动",
          "frame": "00 00 00 00 00 06 32 05 04 0B FF 00",
          "sourceParagraph": 170,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-30",
          "label": "第13路关闭",
          "sourceLabel": "第13路关闭",
          "frame": "00 00 00 00 00 06 32 05 04 0C FF 00",
          "sourceParagraph": 171,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-31",
          "label": "第14路启动",
          "sourceLabel": "第14路启动",
          "frame": "00 00 00 00 00 06 32 05 04 0D FF 00",
          "sourceParagraph": 172,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-32",
          "label": "第14路关闭",
          "sourceLabel": "第14路关闭",
          "frame": "00 00 00 00 00 06 32 05 04 0E FF 00",
          "sourceParagraph": 173,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-33",
          "label": "第15路启动",
          "sourceLabel": "第15路启动",
          "frame": "00 00 00 00 00 06 32 05 04 0F FF 00",
          "sourceParagraph": 174,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-34",
          "label": "第15路关闭",
          "sourceLabel": "第15路关闭",
          "frame": "00 00 00 00 00 06 32 05 04 10 FF 00",
          "sourceParagraph": 175,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-35",
          "label": "第16路启动",
          "sourceLabel": "第16路启动",
          "frame": "00 00 00 00 00 06 32 05 04 11 FF 00",
          "sourceParagraph": 176,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-36",
          "label": "第16路关闭",
          "sourceLabel": "第16路关闭",
          "frame": "00 00 00 00 00 06 32 05 04 12 FF 00",
          "sourceParagraph": 177,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-37",
          "label": "第17路启动",
          "sourceLabel": "第17路启动",
          "frame": "00 00 00 00 00 06 32 05 04 1B FF 00",
          "sourceParagraph": 179,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-38",
          "label": "第17路关闭",
          "sourceLabel": "第17路关闭",
          "frame": "00 00 00 00 00 06 32 05 04 1C FF 00",
          "sourceParagraph": 180,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-39",
          "label": "第18路启动",
          "sourceLabel": "第18路启动",
          "frame": "00 00 00 00 00 06 32 05 04 1D FF 00",
          "sourceParagraph": 181,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-40",
          "label": "第18路关闭",
          "sourceLabel": "第18路关闭",
          "frame": "00 00 00 00 00 06 32 05 04 1E FF 00",
          "sourceParagraph": 182,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-41",
          "label": "第19路启动",
          "sourceLabel": "第19路启动",
          "frame": "00 00 00 00 00 06 32 05 04 1F FF 00",
          "sourceParagraph": 183,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-42",
          "label": "第19路关闭",
          "sourceLabel": "第19路关闭",
          "frame": "00 00 00 00 00 06 32 05 04 20 FF 00",
          "sourceParagraph": 184,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-43",
          "label": "第20路启动",
          "sourceLabel": "第20路启动",
          "frame": "00 00 00 00 00 06 32 05 04 21 FF 00",
          "sourceParagraph": 185,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-44",
          "label": "第20路关闭",
          "sourceLabel": "第20路关闭",
          "frame": "00 00 00 00 00 06 32 05 04 22 FF 00",
          "sourceParagraph": 186,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-45",
          "label": "第21路启动",
          "sourceLabel": "第21路启动",
          "frame": "00 00 00 00 00 06 32 05 04 2B FF 00",
          "sourceParagraph": 188,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-46",
          "label": "第21路关闭",
          "sourceLabel": "第21路关闭",
          "frame": "00 00 00 00 00 06 32 05 04 2C FF 00",
          "sourceParagraph": 189,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-47",
          "label": "第22路启动",
          "sourceLabel": "第22路启动",
          "frame": "00 00 00 00 00 06 32 05 04 2D FF 00",
          "sourceParagraph": 190,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-48",
          "label": "第22路关闭",
          "sourceLabel": "第22路关闭",
          "frame": "00 00 00 00 00 06 32 05 04 2E FF 00",
          "sourceParagraph": 191,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-49",
          "label": "第23路启动",
          "sourceLabel": "第23路启动",
          "frame": "00 00 00 00 00 06 32 05 04 2F FF 00",
          "sourceParagraph": 192,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-50",
          "label": "第23路关闭",
          "sourceLabel": "第23路关闭",
          "frame": "00 00 00 00 00 06 32 05 04 30 FF 00",
          "sourceParagraph": 193,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-51",
          "label": "第24路启动",
          "sourceLabel": "第24路启动",
          "frame": "00 00 00 00 00 06 32 05 04 31 FF 00",
          "sourceParagraph": 194,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-52",
          "label": "第24路关闭",
          "sourceLabel": "第24路关闭",
          "frame": "00 00 00 00 00 06 32 05 04 32 FF 00",
          "sourceParagraph": 195,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-53",
          "label": "第25路启动",
          "sourceLabel": "第25路启动",
          "frame": "00 00 00 00 00 06 32 05 04 3B FF 00",
          "sourceParagraph": 197,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-54",
          "label": "第25路关闭",
          "sourceLabel": "第25路关闭",
          "frame": "00 00 00 00 00 06 32 05 04 3C FF 00",
          "sourceParagraph": 198,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-55",
          "label": "第26路启动",
          "sourceLabel": "第26路启动",
          "frame": "00 00 00 00 00 06 32 05 04 3D FF 00",
          "sourceParagraph": 199,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-56",
          "label": "第26路关闭",
          "sourceLabel": "第26路关闭",
          "frame": "00 00 00 00 00 06 32 05 04 3E FF 00",
          "sourceParagraph": 200,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-57",
          "label": "第27路启动",
          "sourceLabel": "第27路启动",
          "frame": "00 00 00 00 00 06 32 05 04 3F FF 00",
          "sourceParagraph": 201,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-58",
          "label": "第27路关闭",
          "sourceLabel": "第27路关闭",
          "frame": "00 00 00 00 00 06 32 05 04 40 FF 00",
          "sourceParagraph": 202,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-59",
          "label": "第28路启动",
          "sourceLabel": "第28路启动",
          "frame": "00 00 00 00 00 06 32 05 04 41 FF 00",
          "sourceParagraph": 203,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-60",
          "label": "第28路关闭",
          "sourceLabel": "第28路关闭",
          "frame": "00 00 00 00 00 06 32 05 04 42 FF 00",
          "sourceParagraph": 204,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-61",
          "label": "第29路启动",
          "sourceLabel": "第29路启动",
          "frame": "00 00 00 00 00 06 32 05 04 4B FF 00",
          "sourceParagraph": 206,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-62",
          "label": "第29路关闭",
          "sourceLabel": "第29路关闭",
          "frame": "00 00 00 00 00 06 32 05 04 4C FF 00",
          "sourceParagraph": 207,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-63",
          "label": "第30路启动",
          "sourceLabel": "第30路启动",
          "frame": "00 00 00 00 00 06 32 05 04 4D FF 00",
          "sourceParagraph": 208,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-64",
          "label": "第30路关闭",
          "sourceLabel": "第30路关闭",
          "frame": "00 00 00 00 00 06 32 05 04 4E FF 00",
          "sourceParagraph": 209,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-65",
          "label": "第31路启动",
          "sourceLabel": "第31路启动",
          "frame": "00 00 00 00 00 06 32 05 04 4F FF 00",
          "sourceParagraph": 210,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-66",
          "label": "第31路关闭",
          "sourceLabel": "第31路关闭",
          "frame": "00 00 00 00 00 06 32 05 04 50 FF 00",
          "sourceParagraph": 211,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-67",
          "label": "第32路启动",
          "sourceLabel": "第32路启动",
          "frame": "00 00 00 00 00 06 32 05 04 51 FF 00",
          "sourceParagraph": 212,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-68",
          "label": "第32路关闭",
          "sourceLabel": "第32路关闭",
          "frame": "00 00 00 00 00 06 32 05 04 52 FF 00",
          "sourceParagraph": 213,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-69",
          "label": "第33路启动",
          "sourceLabel": "第33路启动",
          "frame": "00 00 00 00 00 06 32 05 04 5B FF 00",
          "sourceParagraph": 215,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-70",
          "label": "第33路关闭",
          "sourceLabel": "第33路关闭",
          "frame": "00 00 00 00 00 06 32 05 04 5C FF 00",
          "sourceParagraph": 216,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-71",
          "label": "第34路启动",
          "sourceLabel": "第34路启动",
          "frame": "00 00 00 00 00 06 32 05 04 5D FF 00",
          "sourceParagraph": 217,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-72",
          "label": "第34路关闭",
          "sourceLabel": "第34路关闭",
          "frame": "00 00 00 00 00 06 32 05 04 5E FF 00",
          "sourceParagraph": 218,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-73",
          "label": "第35路启动",
          "sourceLabel": "第35路启动",
          "frame": "00 00 00 00 00 06 32 05 04 5F FF 00",
          "sourceParagraph": 219,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-74",
          "label": "第35路关闭",
          "sourceLabel": "第35路关闭",
          "frame": "00 00 00 00 00 06 32 05 04 60 FF 00",
          "sourceParagraph": 220,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-75",
          "label": "第36路启动",
          "sourceLabel": "第36路启动",
          "frame": "00 00 00 00 00 06 32 05 04 61 FF 00",
          "sourceParagraph": 221,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-76",
          "label": "第36路关闭",
          "sourceLabel": "第36路关闭",
          "frame": "00 00 00 00 00 06 32 05 04 62 FF 00",
          "sourceParagraph": 222,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-77",
          "label": "第37路启动",
          "sourceLabel": "第37路启动",
          "frame": "00 00 00 00 00 06 32 05 04 6B FF 00",
          "sourceParagraph": 224,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-78",
          "label": "第37路关闭",
          "sourceLabel": "第37路关闭",
          "frame": "00 00 00 00 00 06 32 05 04 6C FF 00",
          "sourceParagraph": 225,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-79",
          "label": "第38路启动",
          "sourceLabel": "第38路启动",
          "frame": "00 00 00 00 00 06 32 05 04 6D FF 00",
          "sourceParagraph": 226,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-80",
          "label": "第38路关闭",
          "sourceLabel": "第38路关闭",
          "frame": "00 00 00 00 00 06 32 05 04 6E FF 00",
          "sourceParagraph": 227,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-81",
          "label": "第39路启动",
          "sourceLabel": "第39路启动",
          "frame": "00 00 00 00 00 06 32 05 04 6F FF 00",
          "sourceParagraph": 228,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-82",
          "label": "第39路关闭",
          "sourceLabel": "第39路关闭",
          "frame": "00 00 00 00 00 06 32 05 04 70 FF 00",
          "sourceParagraph": 229,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-83",
          "label": "第40路启动",
          "sourceLabel": "第40路启动",
          "frame": "00 00 00 00 00 06 32 05 04 71 FF 00",
          "sourceParagraph": 230,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "tcp-write-84",
          "label": "第40路关闭",
          "sourceLabel": "第40路关闭",
          "frame": "00 00 00 00 00 06 32 05 04 72 FF 00",
          "sourceParagraph": 231,
          "copyable": true,
          "category": "write"
        }
      ]
    },
    {
      "id": "rtu",
      "name": "MODBUS-RTU（RS485）",
      "parameters": "站号 50 · 9600 baud · 8 数据位 · 1 停止位 · 无校验",
      "note": "现场站号应按设备配置填写；手册示例站号为50。",
      "commands": [
        {
          "id": "rtu-write-01",
          "label": "一键启动",
          "sourceLabel": "一键启动",
          "frame": "32 05 03 E8 FF 00 09 89",
          "sourceParagraph": 266,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-02",
          "label": "一键停止",
          "sourceLabel": "一键停止",
          "frame": "32 05 03 E9 FF 00 58 49",
          "sourceParagraph": 267,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-03",
          "label": "急停按下",
          "sourceLabel": "急停按下",
          "frame": "32 05 03 EA FF 00 A8 49",
          "sourceParagraph": 268,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-04",
          "label": "急停取消",
          "sourceLabel": "急停取消",
          "frame": "32 05 03 EA 00 00 E9 B9",
          "sourceParagraph": 269,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-05",
          "label": "第1路启动",
          "sourceLabel": "第1路启动",
          "frame": "32 05 03 EB FF 00 F9 89",
          "sourceParagraph": 270,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-06",
          "label": "第1路关闭",
          "sourceLabel": "第1路关闭",
          "frame": "32 05 03 EC FF 00 48 48",
          "sourceParagraph": 271,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-07",
          "label": "第2路启动",
          "sourceLabel": "第2路启动",
          "frame": "32 05 03 ED FF 00 19 88",
          "sourceParagraph": 272,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-08",
          "label": "第2路关闭",
          "sourceLabel": "第2路关闭",
          "frame": "32 05 03 EE FF 00 E9 88",
          "sourceParagraph": 273,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-09",
          "label": "第3路启动",
          "sourceLabel": "第3路启动",
          "frame": "32 05 03 EF FF 00 B8 48",
          "sourceParagraph": 274,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-10",
          "label": "第3路关闭",
          "sourceLabel": "第3路关闭",
          "frame": "32 05 03 F0 FF 00 89 8E",
          "sourceParagraph": 275,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-11",
          "label": "第4路启动",
          "sourceLabel": "第4路启动",
          "frame": "32 05 03 F1 FF 00 D8 4E",
          "sourceParagraph": 276,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-12",
          "label": "第4路关闭",
          "sourceLabel": "第4路关闭",
          "frame": "32 05 03 F2 FF 00 28 4E",
          "sourceParagraph": 277,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-13",
          "label": "第5路启动",
          "sourceLabel": "第5路启动",
          "frame": "32 05 03 F3 FF 00 79 8E",
          "sourceParagraph": 278,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-14",
          "label": "第5路关闭",
          "sourceLabel": "第5路关闭",
          "frame": "32 05 03 F4 FF 00 C8 4F",
          "sourceParagraph": 279,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-15",
          "label": "第6路启动",
          "sourceLabel": "第6路启动",
          "frame": "32 05 03 F5 FF 00 99 8F",
          "sourceParagraph": 280,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-16",
          "label": "第6路关闭",
          "sourceLabel": "第6路关闭",
          "frame": "32 05 03 F6 FF 00 69 8F",
          "sourceParagraph": 281,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-17",
          "label": "第7路启动",
          "sourceLabel": "第7路启动",
          "frame": "32 05 03 F7 FF 00 38 4F",
          "sourceParagraph": 282,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-18",
          "label": "第7路关闭",
          "sourceLabel": "第7路关闭",
          "frame": "32 05 03 F8 FF 00 08 4C",
          "sourceParagraph": 283,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-19",
          "label": "第8路启动",
          "sourceLabel": "第8路启动",
          "frame": "32 05 03 F9 FF 00 59 8C",
          "sourceParagraph": 284,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-20",
          "label": "第8路关闭",
          "sourceLabel": "第8路关闭",
          "frame": "32 05 03 FA FF 00 A9 8C",
          "sourceParagraph": 285,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-21",
          "label": "第9路启动",
          "sourceLabel": "第9路启动",
          "frame": "32 05 03 FB FF 00 F8 4C",
          "sourceParagraph": 287,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-22",
          "label": "第9路关闭",
          "sourceLabel": "第9路关闭",
          "frame": "32 05 03 FC FF 00 49 8D",
          "sourceParagraph": 288,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-23",
          "label": "第10路启动",
          "sourceLabel": "第10路启动",
          "frame": "32 05 03 FD FF 00 18 4D",
          "sourceParagraph": 289,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-24",
          "label": "第10路关闭",
          "sourceLabel": "第10路关闭",
          "frame": "32 05 03 FE FF 00 E8 4D",
          "sourceParagraph": 290,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-25",
          "label": "第11路启动",
          "sourceLabel": "第11路启动",
          "frame": "32 05 03 FF FF 00 B9 8D",
          "sourceParagraph": 291,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-26",
          "label": "第11路关闭",
          "sourceLabel": "第11路关闭",
          "frame": "32 05 04 00 FF 00 88 C9",
          "sourceParagraph": 292,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-27",
          "label": "第12路启动",
          "sourceLabel": "第12路启动",
          "frame": "32 05 04 01 FF 00 D9 09",
          "sourceParagraph": 293,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-28",
          "label": "第12路关闭",
          "sourceLabel": "第12路关闭",
          "frame": "32 05 04 02 FF 00 29 09",
          "sourceParagraph": 294,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-29",
          "label": "第13路启动",
          "sourceLabel": "第13路启动",
          "frame": "32 05 04 0B FF 00 F9 0B",
          "sourceParagraph": 296,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-30",
          "label": "第13路关闭",
          "sourceLabel": "第13路关闭",
          "frame": "32 05 04 0C FF 00 48 CA",
          "sourceParagraph": 297,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-31",
          "label": "第14路启动",
          "sourceLabel": "第14路启动",
          "frame": "32 05 04 0D FF 00 19 0A",
          "sourceParagraph": 298,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-32",
          "label": "第14路关闭",
          "sourceLabel": "第14路关闭",
          "frame": "32 05 04 0E FF 00 E9 0A",
          "sourceParagraph": 299,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-33",
          "label": "第15路启动",
          "sourceLabel": "第15路启动",
          "frame": "32 05 04 0F FF 00 B8 CA",
          "sourceParagraph": 300,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-34",
          "label": "第15路关闭",
          "sourceLabel": "第15路关闭",
          "frame": "32 05 04 10 FF 00 89 0C",
          "sourceParagraph": 301,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-35",
          "label": "第16路启动",
          "sourceLabel": "第16路启动",
          "frame": "32 05 04 11 FF 00 D8 CC",
          "sourceParagraph": 302,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-36",
          "label": "第16路关闭",
          "sourceLabel": "第16路关闭",
          "frame": "32 05 04 12 FF 00 28 CC",
          "sourceParagraph": 303,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-37",
          "label": "第17路启动",
          "sourceLabel": "第17路启动",
          "frame": "32 05 04 1B FF 00 F8 CE",
          "sourceParagraph": 305,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-38",
          "label": "第17路关闭",
          "sourceLabel": "第17路关闭",
          "frame": "32 05 04 1C FF 00 49 0F",
          "sourceParagraph": 306,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-39",
          "label": "第18路启动",
          "sourceLabel": "第18路启动",
          "frame": "32 05 04 1D FF 00 18 CF",
          "sourceParagraph": 307,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-40",
          "label": "第18路关闭",
          "sourceLabel": "第18路关闭",
          "frame": "32 05 04 1E FF 00 E8 CF",
          "sourceParagraph": 308,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-41",
          "label": "第19路启动",
          "sourceLabel": "第19路启动",
          "frame": "32 05 04 1F FF 00 B9 0F",
          "sourceParagraph": 309,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-42",
          "label": "第19路关闭",
          "sourceLabel": "第19路关闭",
          "frame": "32 05 04 20 FF 00 89 03",
          "sourceParagraph": 310,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-43",
          "label": "第20路启动",
          "sourceLabel": "第20路启动",
          "frame": "32 05 04 21 FF 00 D8 C3",
          "sourceParagraph": 311,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-44",
          "label": "第20路关闭",
          "sourceLabel": "第20路关闭",
          "frame": "32 05 04 22 FF 00 28 C3",
          "sourceParagraph": 312,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-45",
          "label": "第21路启动",
          "sourceLabel": "第21路启动",
          "frame": "32 05 04 2B FF 00 F8 C1",
          "sourceParagraph": 314,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-46",
          "label": "第21路关闭",
          "sourceLabel": "第21路关闭",
          "frame": "32 05 04 2C FF 00 49 00",
          "sourceParagraph": 315,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-47",
          "label": "第22路启动",
          "sourceLabel": "第22路启动",
          "frame": "32 05 04 2D FF 00 18 C0",
          "sourceParagraph": 316,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-48",
          "label": "第22路关闭",
          "sourceLabel": "第22路关闭",
          "frame": "32 05 04 2E FF 00 E8 C0",
          "sourceParagraph": 317,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-49",
          "label": "第23路启动",
          "sourceLabel": "第23路启动",
          "frame": "32 05 04 2F FF 00 B9 00",
          "sourceParagraph": 318,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-50",
          "label": "第23路关闭",
          "sourceLabel": "第23路关闭",
          "frame": "32 05 04 30 FF 00 88 C6",
          "sourceParagraph": 319,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-51",
          "label": "第24路启动",
          "sourceLabel": "第24路启动",
          "frame": "32 05 04 31 FF 00 D9 06",
          "sourceParagraph": 320,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-52",
          "label": "第24路关闭",
          "sourceLabel": "第24路关闭",
          "frame": "32 05 04 32 FF 00 29 06",
          "sourceParagraph": 321,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-53",
          "label": "第25路启动",
          "sourceLabel": "第25路启动",
          "frame": "32 05 04 3B FF 00 F9 04",
          "sourceParagraph": 323,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-54",
          "label": "第25路关闭",
          "sourceLabel": "第25路关闭",
          "frame": "32 05 04 3C FF 00 48 C5",
          "sourceParagraph": 324,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-55",
          "label": "第26路启动",
          "sourceLabel": "第26路启动",
          "frame": "32 05 04 3D FF 00 19 05",
          "sourceParagraph": 325,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-56",
          "label": "第26路关闭",
          "sourceLabel": "第26路关闭",
          "frame": "32 05 04 3E FF 00 E9 05",
          "sourceParagraph": 326,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-57",
          "label": "第27路启动",
          "sourceLabel": "第27路启动",
          "frame": "32 05 04 3F FF 00 B8 C5",
          "sourceParagraph": 327,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-58",
          "label": "第27路关闭",
          "sourceLabel": "第27路关闭",
          "frame": "32 05 04 40 FF 00 89 1D",
          "sourceParagraph": 328,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-59",
          "label": "第28路启动",
          "sourceLabel": "第28路启动",
          "frame": "32 05 04 41 FF 00 D8 DD",
          "sourceParagraph": 329,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-60",
          "label": "第28路关闭",
          "sourceLabel": "第28路关闭",
          "frame": "32 05 04 42 FF 00 28 DD",
          "sourceParagraph": 330,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-61",
          "label": "第29路启动",
          "sourceLabel": "第29路启动",
          "frame": "32 05 04 4B FF 00 F8 DF",
          "sourceParagraph": 332,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-62",
          "label": "第29路关闭",
          "sourceLabel": "第29路关闭",
          "frame": "32 05 04 4C FF 00 49 1E",
          "sourceParagraph": 333,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-63",
          "label": "第30路启动",
          "sourceLabel": "第30路启动",
          "frame": "32 05 04 4D FF 00 18 DE",
          "sourceParagraph": 334,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-64",
          "label": "第30路关闭",
          "sourceLabel": "第30路关闭",
          "frame": "32 05 04 4E FF 00 E8 DE",
          "sourceParagraph": 335,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-65",
          "label": "第31路启动",
          "sourceLabel": "第31路启动",
          "frame": "32 05 04 4F FF 00 B9 1E",
          "sourceParagraph": 336,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-66",
          "label": "第31路关闭",
          "sourceLabel": "第31路关闭",
          "frame": "32 05 04 50 FF 00 88 D8",
          "sourceParagraph": 337,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-67",
          "label": "第32路启动",
          "sourceLabel": "第32路启动",
          "frame": "32 05 04 51 FF 00 D9 18",
          "sourceParagraph": 338,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-68",
          "label": "第32路关闭",
          "sourceLabel": "第32路关闭",
          "frame": "32 05 04 52 FF 00 29 18",
          "sourceParagraph": 339,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-69",
          "label": "第33路启动",
          "sourceLabel": "第33路启动",
          "frame": "32 05 04 5B FF 00 F9 1A",
          "sourceParagraph": 341,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-70",
          "label": "第33路关闭",
          "sourceLabel": "第33路关闭",
          "frame": "32 05 04 5C FF 00 48 DB",
          "sourceParagraph": 342,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-71",
          "label": "第34路启动",
          "sourceLabel": "第34路启动",
          "frame": "32 05 04 5D FF 00 19 1B",
          "sourceParagraph": 343,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-72",
          "label": "第34路关闭",
          "sourceLabel": "第34路关闭",
          "frame": "32 05 04 5E FF 00 E9 1B",
          "sourceParagraph": 344,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-73",
          "label": "第35路启动",
          "sourceLabel": "第35路启动",
          "frame": "32 05 04 5F FF 00 B8 DB",
          "sourceParagraph": 345,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-74",
          "label": "第35路关闭",
          "sourceLabel": "第35路关闭",
          "frame": "32 05 04 60 FF 00 88 D7",
          "sourceParagraph": 346,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-75",
          "label": "第36路启动",
          "sourceLabel": "第36路启动",
          "frame": "32 05 04 61 FF 00 D9 17",
          "sourceParagraph": 347,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-76",
          "label": "第36路关闭",
          "sourceLabel": "第36路关闭",
          "frame": "32 05 04 62 FF 00 29 17",
          "sourceParagraph": 348,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-77",
          "label": "第37路启动",
          "sourceLabel": "第37路启动",
          "frame": "32 05 04 6B FF 00 F9 15",
          "sourceParagraph": 350,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-78",
          "label": "第37路关闭",
          "sourceLabel": "第37路关闭",
          "frame": "32 05 04 6C FF 00 48 D4",
          "sourceParagraph": 351,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-79",
          "label": "第38路启动",
          "sourceLabel": "第38路启动",
          "frame": "32 05 04 6D FF 00 19 14",
          "sourceParagraph": 352,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-80",
          "label": "第38路关闭",
          "sourceLabel": "第38路关闭",
          "frame": "32 05 04 6E FF 00 E9 14",
          "sourceParagraph": 353,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-81",
          "label": "第39路启动",
          "sourceLabel": "第39路启动",
          "frame": "32 05 04 6F FF 00 B8 D4",
          "sourceParagraph": 354,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-82",
          "label": "第39路关闭",
          "sourceLabel": "第39路关闭",
          "frame": "32 05 04 70 FF 00 89 12",
          "sourceParagraph": 355,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-83",
          "label": "第40路启动",
          "sourceLabel": "第40路启动",
          "frame": "32 05 04 71 FF 00 D8 D2",
          "sourceParagraph": 356,
          "copyable": true,
          "category": "write"
        },
        {
          "id": "rtu-write-84",
          "label": "第40路关闭",
          "sourceLabel": "第40路关闭",
          "frame": "32 05 04 72 FF 00 28 D2",
          "sourceParagraph": 357,
          "copyable": true,
          "category": "write"
        }
      ]
    }
  ]
};

module.exports = { formalManual }
