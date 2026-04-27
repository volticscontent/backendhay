/**
 * Rotas de consulta de CNPJ
 * Endpoint REST para validação e consulta de informações de CNPJ
 */

import { Router } from 'express';
import { cnpjService, CNPJValidator } from '../lib/cnpj-service';
import { bootLogger } from '../lib/logger';

const router = Router();

/**
 * GET /api/cnpj/:cnpj
 * Consulta informações de um CNPJ específico
 */
router.get('/cnpj/:cnpj', async (req, res) => {
  const { cnpj } = req.params;
  const clientIp = req.ip || req.connection.remoteAddress;

  try {
    bootLogger.info(`Consulta CNPJ: ${cnpj} - IP: ${clientIp}`);
    
    const result = await cnpjService.consultarCNPJ(cnpj, clientIp);
    
    if (result.success) {
      res.json({
        success: true,
        data: result.data,
        cached: result.cached,
        api_source: result.api_source,
        timestamp: result.timestamp
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error,
        timestamp: result.timestamp
      });
    }
  } catch (error) {
    bootLogger.error(`Erro ao processar consulta CNPJ: ${cnpj}`, error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Erro interno ao processar consulta'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /api/cnpj/batch
 * Consulta múltiplos CNPJs em lote
 * Body: { "cnpjs": ["cnpj1", "cnpj2", ...] }
 */
router.post('/cnpj/batch', async (req, res) => {
  const { cnpjs } = req.body;
  const clientIp = req.ip || req.connection.remoteAddress;

  // Validação do payload
  if (!Array.isArray(cnpjs) || cnpjs.length === 0) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_PAYLOAD',
        message: 'Payload deve conter array de CNPJs'
      },
      timestamp: new Date().toISOString()
    });
  }

  if (cnpjs.length > 50) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'BATCH_TOO_LARGE',
        message: 'Máximo de 50 CNPJs por requisição'
      },
      timestamp: new Date().toISOString()
    });
  }

  try {
    bootLogger.info(`Consulta lote CNPJs: ${cnpjs.length} CNPJs - IP: ${clientIp}`);
    
    const results = await cnpjService.consultarLote(cnpjs, clientIp);
    
    // Estatísticas
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const cached = results.filter(r => r.cached).length;

    res.json({
      success: true,
      results,
      statistics: {
        total: results.length,
        successful,
        failed,
        cached
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    bootLogger.error(`Erro ao processar lote CNPJs: ${cnpjs.length} CNPJs`, error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Erro interno ao processar lote de consultas'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /api/cnpj/validate
 * Valida formato e dígitos verificadores de CNPJ
 * Body: { "cnpj": "cnpj" }
 */
router.post('/cnpj/validate', (req, res) => {
  const { cnpj } = req.body;

  if (!cnpj) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'MISSING_CNPJ',
        message: 'CNPJ é obrigatório'
      },
      timestamp: new Date().toISOString()
    });
  }

  try {
    const isValid = CNPJValidator.isValid(cnpj);
    const formatted = CNPJValidator.format(cnpj);
    const cleaned = CNPJValidator.clean(cnpj);

    res.json({
      success: true,
      valid: isValid,
      formatted,
      cleaned,
      message: isValid ? 'CNPJ válido' : CNPJValidator.getErrorMessage(cnpj),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    bootLogger.error(`Erro ao validar CNPJ: ${cnpj}`, error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Erro interno ao validar CNPJ'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/cnpj/cache/stats
 * Retorna estatísticas do cache
 */
router.get('/cnpj/cache/stats', (req, res) => {
  try {
    const stats = cnpjService.getCacheStats();
    res.json({
      success: true,
      stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    bootLogger.error('Erro ao obter estatísticas do cache', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Erro interno ao obter estatísticas'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * DELETE /api/cnpj/cache
 * Limpa o cache de CNPJs
 */
router.delete('/cnpj/cache', (req, res) => {
  try {
    cnpjService.clearCache();
    bootLogger.info('Cache de CNPJ limpo por requisição');
    
    res.json({
      success: true,
      message: 'Cache limpo com sucesso',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    bootLogger.error('Erro ao limpar cache', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Erro interno ao limpar cache'
      },
      timestamp: new Date().toISOString()
    });
  }
});

export default router;