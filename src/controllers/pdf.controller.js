const pdfService = require('../services/pdf.service');

async function create(req, res, next) {
  try {
    const pdfFile = req.files?.file?.[0];
    const coverFile = req.files?.cover?.[0] || null;

    if (!pdfFile) {
      return res.status(400).json({ error: 'PDF file is required' });
    }

    const product = await pdfService.createProduct({
      sellerId: req.user.id,
      title: req.body.title,
      description: req.body.description || null,
      price: parseFloat(req.body.price),
      allowDownload: req.body.allow_download === 'true' || req.body.allow_download === true,
      file: pdfFile,
      coverFile,
    });

    res.status(201).json(product);
  } catch (err) {
    next(err);
  }
}

async function getById(req, res, next) {
  try {
    const product = await pdfService.getProductById(req.params.id);
    res.json(product);
  } catch (err) {
    next(err);
  }
}

async function getByCode(req, res, next) {
  try {
    const product = await pdfService.getProductByCode(req.params.code);
    res.json(product);
  } catch (err) {
    next(err);
  }
}

async function list(req, res, next) {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const products = await pdfService.listProducts({ page, limit });
    res.json(products);
  } catch (err) {
    next(err);
  }
}

async function search(req, res, next) {
  try {
    const query = req.query.q || '';
    if (!query.trim()) {
      return res.json([]);
    }
    const products = await pdfService.searchProducts(query);
    res.json(products);
  } catch (err) {
    next(err);
  }
}

async function myProducts(req, res, next) {
  try {
    const products = await pdfService.listSellerProducts(req.user.id);
    res.json(products);
  } catch (err) {
    next(err);
  }
}

/**
 * Generate signed URL for an authorised buyer.
 */
async function access(req, res, next) {
  try {
    const data = await pdfService.getSignedUrl(req.params.id, req.user.id);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

/**
 * Delete a product listing.
 */
async function deleteProduct(req, res, next) {
  try {
    const result = await pdfService.deleteProduct(req.params.id, req.user.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * Update product price.
 */
async function updatePrice(req, res, next) {
  try {
    const newPrice = parseFloat(req.body.price);
    if (isNaN(newPrice)) {
      return res.status(400).json({ error: 'Invalid price' });
    }
    const product = await pdfService.updatePrice(req.params.id, req.user.id, newPrice);
    res.json(product);
  } catch (err) {
    next(err);
  }
}

module.exports = { create, getById, getByCode, list, search, myProducts, access, deleteProduct, updatePrice };
