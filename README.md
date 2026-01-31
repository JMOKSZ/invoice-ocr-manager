# Invoice OCR Manager

基于OCR的智能发票管理工具，自动识别和记录发票信息，帮助用户轻松管理财务票据。

## 功能特色

- 📷 **智能OCR识别** - 使用PaddleOCR-VL-1.5识别发票信息
- 🧾 **自动信息提取** - 自动提取发票号码、日期、金额等关键信息
- 💰 **财务分类** - 智能分类不同类型的发票和支出
- 📊 **数据导出** - 支持导出为Excel、CSV等格式
- 🔍 **智能搜索** - 快速查找特定发票
- 📅 **时间线视图** - 按时间查看发票记录
- 📈 **统计分析** - 生成支出报表和趋势分析

## 安装

```bash
git clone https://github.com/JMOKSZ/invoice-ocr-manager.git
cd invoice-ocr-manager
npm install
```

## 使用

```bash
# 处理单张发票图片
node index.js --image ./invoice.jpg

# 批量处理发票
node index.js --batch ./invoices/

# 启动GUI界面
npm start

# 导出发票数据
node index.js --export csv
```

## 依赖

- PaddleOCR-VL-1.5 (已预配置)
- Node.js 16+
- Python 3.8+

## 配置

复制 `.env.example` 为 `.env` 并填入相应配置：

```bash
cp .env.example .env
```

## 贡献

欢迎提交Issue和Pull Request来帮助改进此项目。