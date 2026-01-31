/**
 * Invoice OCR Manager
 * 基于OCR的智能发票管理工具
 */

require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const xlsx = require('xlsx');
const moment = require('moment');

class InvoiceOCRManager {
  constructor() {
    this.invoiceDB = []; // 简单内存数据库，实际项目中应使用SQLite或MongoDB
    this.uploadDir = './uploads';
    this.processedDir = './processed';
    this.initDirectories();
  }

  /**
   * 初始化目录
   */
  async initDirectories() {
    try {
      await fs.mkdir(this.uploadDir, { recursive: true });
      await fs.mkdir(this.processedDir, { recursive: true });
    } catch (error) {
      console.error('初始化目录时出错:', error.message);
    }
  }

  /**
   * 使用PaddleOCR识别发票信息
   */
  async recognizeInvoice(imagePath) {
    try {
      // 使用Python脚本调用PaddleOCR
      // 这里假设系统已安装PaddleOCR
      const pythonScript = `
import sys
sys.path.append('/opt/homebrew/lib/python3.12/site-packages')
import cv2
import paddle
from paddleocr import PaddleOCR

# 初始化OCR
ocr = PaddleOCR(use_angle_cls=True, lang='ch')

# 读取图像
result = ocr.ocr('${imagePath}', cls=True)

# 提取文本
texts = []
for idx in range(len(result)):
    res = result[idx]
    for line in res:
        texts.append(line[1][0])

# 输出结果
print('|'.join(texts))
`;

      // 将Python脚本保存到临时文件
      const tempPyFile = path.join(this.uploadDir, 'temp_ocr_script.py');
      await fs.writeFile(tempPyFile, pythonScript, 'utf8');

      // 执行Python脚本
      const { stdout, stderr } = await execAsync(`python3 ${tempPyFile}`);
      
      if (stderr) {
        console.error('Python脚本执行错误:', stderr);
      }

      // 解析OCR结果
      const extractedText = stdout.trim();
      const lines = extractedText.split('|');
      
      // 尝试提取发票关键信息
      const invoiceInfo = this.parseInvoiceInfo(lines);
      
      return {
        success: true,
        extractedText: lines,
        parsedInfo: invoiceInfo,
        imagePath: imagePath
      };
    } catch (error) {
      console.error('OCR识别过程中出错:', error.message);
      return {
        success: false,
        error: error.message,
        imagePath: imagePath
      };
    }
  }

  /**
   * 解析发票信息
   */
  parseInvoiceInfo(lines) {
    const info = {
      invoiceNumber: null,
      date: null,
      totalAmount: null,
      supplier: null,
      items: []
    };

    // 简单的正则匹配逻辑
    for (const line of lines) {
      // 匹配发票号码
      if (!info.invoiceNumber) {
        const invoiceMatch = line.match(/发票号码[:：]?\s*([A-Z0-9]+)/i);
        if (invoiceMatch) {
          info.invoiceNumber = invoiceMatch[1];
        }
      }

      // 匹配日期
      if (!info.date) {
        const dateMatch = line.match(/(\d{4}年\d{1,2}月\d{1,2}日|\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})/);
        if (dateMatch) {
          info.date = dateMatch[1];
        }
      }

      // 匹配总金额
      if (!info.totalAmount) {
        const amountMatch = line.match(/[总计合计].*?(\d+\.?\d*)/);
        if (amountMatch) {
          info.totalAmount = parseFloat(amountMatch[1]);
        } else {
          // 尝试匹配包含¥或$的金额
          const currencyMatch = line.match(/[¥$€]\s*(\d+\.?\d*)/);
          if (currencyMatch) {
            info.totalAmount = parseFloat(currencyMatch[1]);
          }
        }
      }

      // 匹配供应商名称
      if (!info.supplier) {
        const supplierKeywords = ['公司', '有限公司', '店', '商行', '超市'];
        if (supplierKeywords.some(keyword => line.includes(keyword))) {
          info.supplier = line.trim();
        }
      }
    }

    return info;
  }

  /**
   * 保存发票信息到数据库
   */
  async saveInvoice(invoiceData) {
    const invoiceRecord = {
      id: Date.now(), // 简单ID生成，实际项目中应使用UUID
      ...invoiceData,
      createdAt: new Date().toISOString()
    };

    this.invoiceDB.push(invoiceRecord);
    console.log(`发票已保存: ${invoiceRecord.id}`);

    // 保存到文件（模拟数据库）
    await this.saveToFile();

    return invoiceRecord;
  }

  /**
   * 保存到文件（模拟数据库）
   */
  async saveToFile() {
    try {
      const dbPath = path.join(__dirname, 'invoices.json');
      await fs.writeFile(dbPath, JSON.stringify(this.invoiceDB, null, 2), 'utf8');
    } catch (error) {
      console.error('保存数据库时出错:', error.message);
    }
  }

  /**
   * 从文件加载数据库
   */
  async loadFromFile() {
    try {
      const dbPath = path.join(__dirname, 'invoices.json');
      const data = await fs.readFile(dbPath, 'utf8');
      this.invoiceDB = JSON.parse(data);
    } catch (error) {
      // 如果文件不存在，使用空数组
      this.invoiceDB = [];
    }
  }

  /**
   * 处理单张发票图片
   */
  async processInvoiceImage(imagePath) {
    console.log(`正在处理发票: ${imagePath}`);
    
    // OCR识别
    const recognitionResult = await this.recognizeInvoice(imagePath);
    
    if (!recognitionResult.success) {
      console.error(`OCR识别失败: ${recognitionResult.error}`);
      return recognitionResult;
    }

    // 保存发票信息
    const savedInvoice = await this.saveInvoice({
      originalImagePath: imagePath,
      extractedText: recognitionResult.extractedText,
      ...recognitionResult.parsedInfo
    });

    // 移动文件到已处理目录
    const fileName = path.basename(imagePath);
    const newFilePath = path.join(this.processedDir, fileName);
    await fs.copyFile(imagePath, newFilePath);

    console.log(`发票处理完成: ${savedInvoice.id}`);
    
    return {
      ...recognitionResult,
      invoiceRecord: savedInvoice
    };
  }

  /**
   * 批量处理发票
   */
  async processBatch(imagePaths) {
    console.log(`开始批量处理 ${imagePaths.length} 张发票`);
    
    const results = [];
    
    for (let i = 0; i < imagePaths.length; i++) {
      console.log(`正在处理第 ${i + 1}/${imagePaths.length} 张发票`);
      
      const result = await this.processInvoiceImage(imagePaths[i]);
      results.push(result);
      
      // 避免处理过快
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    return results;
  }

  /**
   * 导出发票数据
   */
  async exportData(format = 'json') {
    switch (format.toLowerCase()) {
      case 'csv':
        return this.exportToCSV();
      case 'excel':
      case 'xlsx':
        return this.exportToExcel();
      default:
        return this.exportToJSON();
    }
  }

  /**
   * 导出为JSON
   */
  async exportToJSON() {
    const exportPath = path.join(__dirname, `invoices_export_${Date.now()}.json`);
    await fs.writeFile(exportPath, JSON.stringify(this.invoiceDB, null, 2), 'utf8');
    return exportPath;
  }

  /**
   * 导出为CSV
   */
  async exportToCSV() {
    // 简单CSV导出
    const csvRows = [
      ['ID', '发票号码', '日期', '总金额', '供应商', '创建时间'].join(',')
    ];
    
    for (const invoice of this.invoiceDB) {
      const row = [
        invoice.id,
        `"${invoice.invoiceNumber || ''}"`,
        `"${invoice.date || ''}"`,
        invoice.totalAmount || '',
        `"${invoice.supplier || ''}"`,
        `"${invoice.createdAt || ''}"`
      ].join(',');
      csvRows.push(row);
    }
    
    const csvContent = csvRows.join('\n');
    const exportPath = path.join(__dirname, `invoices_export_${Date.now()}.csv`);
    await fs.writeFile(exportPath, csvContent, 'utf8');
    return exportPath;
  }

  /**
   * 导出为Excel
   */
  async exportToExcel() {
    // 创建工作簿
    const wb = xlsx.utils.book_new();
    
    // 准备数据
    const wsData = [
      ['ID', '发票号码', '日期', '总金额', '供应商', '创建时间']
    ];
    
    for (const invoice of this.invoiceDB) {
      wsData.push([
        invoice.id,
        invoice.invoiceNumber || '',
        invoice.date || '',
        invoice.totalAmount || '',
        invoice.supplier || '',
        invoice.createdAt || ''
      ]);
    }
    
    // 创建工作表
    const ws = xlsx.utils.aoa_to_sheet(wsData);
    xlsx.utils.book_append_sheet(wb, ws, '发票记录');
    
    // 保存文件
    const exportPath = path.join(__dirname, `invoices_export_${Date.now()}.xlsx`);
    xlsx.writeFile(wb, exportPath);
    
    return exportPath;
  }

  /**
   * 获取发票统计信息
   */
  getStatistics() {
    if (this.invoiceDB.length === 0) {
      return {
        totalInvoices: 0,
        totalAmount: 0,
        averageAmount: 0,
        dateRange: null
      };
    }

    const amounts = this.invoiceDB
      .map(inv => inv.totalAmount)
      .filter(amt => amt !== null && !isNaN(amt));

    const totalAmount = amounts.reduce((sum, amt) => sum + amt, 0);
    const averageAmount = amounts.length > 0 ? totalAmount / amounts.length : 0;

    // 日期范围
    const dates = this.invoiceDB
      .map(inv => inv.createdAt)
      .filter(date => date !== null)
      .sort();

    const dateRange = dates.length > 0 ? {
      start: dates[0],
      end: dates[dates.length - 1]
    } : null;

    return {
      totalInvoices: this.invoiceDB.length,
      totalAmount: totalAmount,
      averageAmount: averageAmount,
      dateRange: dateRange
    };
  }

  /**
   * 搜索发票
   */
  searchInvoices(query) {
    const lowerQuery = query.toLowerCase();
    return this.invoiceDB.filter(invoice => {
      return (
        (invoice.invoiceNumber && invoice.invoiceNumber.toLowerCase().includes(lowerQuery)) ||
        (invoice.supplier && invoice.supplier.toLowerCase().includes(lowerQuery)) ||
        (invoice.totalAmount && invoice.totalAmount.toString().includes(lowerQuery)) ||
        (invoice.date && invoice.date.toLowerCase().includes(lowerQuery))
      );
    });
  }

  /**
   * 启动API服务
   */
  async startApiService(port = 3001) {
    const app = express();
    const upload = multer({ dest: this.uploadDir });

    // 加载现有数据
    await this.loadFromFile();

    // 中间件
    app.use(express.json());
    app.use('/uploads', express.static(this.uploadDir));
    app.use('/processed', express.static(this.processedDir));

    // 上传发票接口
    app.post('/upload', upload.single('invoice'), async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: '请上传发票图片' });
        }

        const result = await this.processInvoiceImage(req.file.path);
        
        res.json({
          success: true,
          result: result
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // 批量上传接口
    app.post('/upload/batch', upload.array('invoices', 10), async (req, res) => {
      try {
        if (!req.files || req.files.length === 0) {
          return res.status(400).json({ error: '请上传发票图片' });
        }

        const imagePaths = req.files.map(file => file.path);
        const results = await this.processBatch(imagePaths);
        
        res.json({
          success: true,
          results: results
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // 获取所有发票
    app.get('/invoices', (req, res) => {
      res.json({
        success: true,
        invoices: this.invoiceDB
      });
    });

    // 搜索发票
    app.get('/invoices/search', (req, res) => {
      const { q } = req.query;
      if (!q) {
        return res.json({
          success: true,
          invoices: this.invoiceDB
        });
      }

      const results = this.searchInvoices(q);
      res.json({
        success: true,
        invoices: results
      });
    });

    // 获取统计信息
    app.get('/stats', (req, res) => {
      const stats = this.getStatistics();
      res.json({
        success: true,
        stats: stats
      });
    });

    // 导出数据
    app.get('/export/:format', async (req, res) => {
      try {
        const { format } = req.params;
        const exportPath = await this.exportData(format);
        
        res.download(exportPath, (err) => {
          if (err) {
            console.error('下载文件时出错:', err);
          }
          // 可以选择删除临时导出文件
          // fs.unlink(exportPath).catch(() => {});
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    app.listen(port, () => {
      console.log(`发票OCR管理服务已启动，监听端口 ${port}`);
      console.log(`API端点:`);
      console.log(`  POST /upload - 上传单张发票`);
      console.log(`  POST /upload/batch - 批量上传发票`);
      console.log(`  GET /invoices - 获取所有发票`);
      console.log(`  GET /invoices/search?q=keyword - 搜索发票`);
      console.log(`  GET /stats - 获取统计信息`);
      console.log(`  GET /export/:format - 导出数据 (json/csv/xlsx)`);
    });
  }
}

// 如果直接运行此文件
if (require.main === module) {
  const args = process.argv.slice(2);
  const manager = new InvoiceOCRManager();
  
  // 解析命令行参数
  const imageIndex = args.indexOf('--image');
  const batchIndex = args.indexOf('--batch');
  const exportIndex = args.indexOf('--export');
  const apiIndex = args.indexOf('--api');
  const portIndex = args.indexOf('--port');
  
  (async () => {
    try {
      if (apiIndex !== -1) {
        // 启动API服务
        const port = portIndex !== -1 ? parseInt(args[portIndex + 1]) || 3001 : 3001;
        await manager.startApiService(port);
      } else if (imageIndex !== -1) {
        // 处理单张图片
        const imagePath = args[imageIndex + 1];
        const result = await manager.processInvoiceImage(imagePath);
        
        console.log('处理结果:');
        console.log(JSON.stringify(result, null, 2));
      } else if (batchIndex !== -1) {
        // 批量处理
        const dirPath = args[batchIndex + 1];
        const files = await fs.readdir(dirPath);
        const imageFiles = files.filter(file => 
          file.toLowerCase().endsWith('.jpg') || 
          file.toLowerCase().endsWith('.jpeg') || 
          file.toLowerCase().endsWith('.png') || 
          file.toLowerCase().endsWith('.bmp')
        );
        
        const imagePaths = imageFiles.map(file => path.join(dirPath, file));
        const results = await manager.processBatch(imagePaths);
        
        console.log(`批量处理完成，成功处理 ${results.filter(r => r.success).length} 张发票`);
      } else if (exportIndex !== -1) {
        // 导出数据
        const format = args[exportIndex + 1] || 'json';
        const exportPath = await manager.exportData(format);
        
        console.log(`数据已导出到: ${exportPath}`);
      } else {
        // 显示帮助信息
        console.log('发票OCR管理工具');
        console.log('');
        console.log('使用方法:');
        console.log('  node index.js --image ./invoice.jpg');
        console.log('  node index.js --batch ./invoices/');
        console.log('  node index.js --export csv');
        console.log('  node index.js --api [--port 3001]');
        console.log('');
      }
    } catch (error) {
      console.error('执行过程中出错:', error);
    }
  })();
}

module.exports = InvoiceOCRManager;