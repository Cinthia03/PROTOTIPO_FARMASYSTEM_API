require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const { Pool } = require("pg");   

// ================================================
//           CONFIGURACIÓN APP
// ================================================
const app = express();
const PORT = process.env.PORT || 3000;


// ================================================
//           MIDDLEWARE & CORS FLEXIBLE
// ================================================
app.use(express.json());
const origenesPermitidos = [
  'http://localhost:4200',
  'https://prototipo-farmasystem-ug.vercel.app'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    
    if (origenesPermitidos.includes(origin) || origin.endsWith('.vercel.app')) {
      return callback(null, true);
    } else {
      console.error(`🚫 Bloqueado por CORS: El origen [${origin}] no está autorizado.`);
      return callback(new Error('Bloqueado por CORS: Origen no permitido por Farmasystem'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));


// ================================================
//           CONEXIÓN A BASE DE DATOS
// ================================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});
pool.connect()
  .then(() => console.log("✅ Conectado a Supabase"))
  .catch(err => console.error("❌ Error conexión:", err));


// ================================================
//           LOGIN - USUARIOS
// ================================================
app.post('/api/login', async (req, res) => {
  try {
    const { usuario, contrasena } = req.body;

    if (!usuario || !contrasena) {
      return res.status(400).json({ message: 'Faltan usuario o contraseña' });
    }

    // 🌟 Cambiamos a "identificacion AS id" porque así se llama tu columna en Supabase
    const result = await pool.query(
      'SELECT identificacion AS id, usuario, nombre, rol, contrasena FROM usuarios WHERE usuario = $1',
      [usuario]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Usuario no encontrado' });
    }

    const user = result.rows[0];

    const ok = await bcrypt.compare(contrasena, user.contrasena);
    if (!ok) {
      return res.status(401).json({ message: 'Contraseña incorrecta' });
    }

    // Retorna el ID numérico de forma correcta hacia Angular
    return res.json({
      id: user.id, // Esto tomará el valor numérico (1, 2 o 3)
      usuario: user.usuario,
      nombre: user.nombre,
      rol: user.rol
    });
  } catch (err) {
    console.error('ERROR LOGIN:', err);
    return res.status(500).json({ message: err.message });
  }
});


// ============================================================
//               INVENTARIO GENERAL (DASHBOARD Y KPIs)
// ============================================================

// ============================================================
//          2. CATEGORÍAS 
// ============================================================

// Endpoint para obtener categorías por módulo (ej: 'medicamentos')
app.get('/api/categorias/modulo/:modulo', async (req, res) => {
  try {
    const { modulo } = req.params;
    
    // IMPORTANTE: Asegúrate de que las columnas coincidan con tu tabla real.
    // Si tu columna se llama diferente a "nombre", usa un ALIAS (AS nombre) 
    // para que Angular lo detecte sin romper el HTML.
    const result = await pool.query(
      'SELECT id, nombre_categoria AS nombre, modulo FROM categorias WHERE modulo = $1 ORDER BY nombre_categoria',
      [modulo]
    );

    // Devolvemos el array directo (lo que tu condición `Array.isArray(resp)` espera)
    res.json(result.rows);
  } catch (err) {
    console.error('ERROR CATEGORIAS:', err);
    res.status(500).json({ error: err.message });
  }
});

// TOTAL MEDICAMENTOS
app.get('/api/total-medicamentos', async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) FROM medicamentos WHERE activo = true');
    res.json({ total: parseInt(result.rows[0].count) });
  } catch (error) {
    res.status(500).json({ message: 'Error obteniendo medicamentos' });
  }
});

// TOTAL INSUMOS
app.get('/api/total-insumos', async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) FROM insumos_medicos WHERE activo = true');
    res.json({ total: parseInt(result.rows[0].count) });
  } catch (error) {
    res.status(500).json({ message: 'Error obteniendo insumos' });
  }
});

// TOTAL CUIDADO PERSONAL
app.get('/api/total-cuidado-personal', async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) FROM cuidado_personal WHERE activo = true');
    res.json({ total: parseInt(result.rows[0].count) });
  } catch (error) {
    res.status(500).json({ message: 'Error obteniendo cuidado personal' });
  }
});

// KPI MEDICAMENTOS
app.get('/api/medicamentos-kpi', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COALESCE(SUM(stock * precio_venta), 0) AS "valorTotal",
        COUNT(CASE WHEN COALESCE(stock, 0) <= COALESCE(stock_minimo, 0) THEN 1 END) AS "stockBajo",
        COALESCE(
          ROUND(
            (COUNT(CASE WHEN COALESCE(stock, 0) > COALESCE(stock_minimo, 0) THEN 1 END) * 100.0) / NULLIF(COUNT(*), 0)::numeric,
            0
          ),
          0
        ) AS "stockDisponible"
      FROM medicamentos WHERE activo = true
    `);
    res.json({
      valorTotal: parseFloat(result.rows[0].valorTotal) || 0,
      stockBajo: parseInt(result.rows[0].stockBajo) || 0,
      stockDisponible: parseInt(result.rows[0].stockDisponible) || 0
    });
  } catch (error) {
    console.error('--- ERROR EN MEDICAMENTOS-KPI ---', error);
    res.status(500).json({ message: 'Error obteniendo KPI medicamentos' });
  }
});

// KPI INSUMOS MÉDICOS
app.get('/api/insumos-kpi', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) AS total,
        COALESCE(ROUND(AVG(precio_venta)::numeric, 2), 0) AS "tarifaPromedio",
        COUNT(DISTINCT unidad_medida) AS categorias
      FROM insumos_medicos WHERE activo = true
    `);
    const total = parseInt(result.rows[0].total) || 0;
    res.json({
      tarifaPromedio: parseFloat(result.rows[0].tarifaPromedio) || 0,
      categorias: parseInt(result.rows[0].categorias) || 0,
      porcentajeActivo: total > 0 ? 100 : 0
    });
  } catch (error) {
    console.error('--- ERROR EN INSUMOS-KPI ---', error);
    res.status(500).json({ message: 'Error obteniendo KPI insumos' });
  }
});

// KPI CUIDADO PERSONAL
app.get('/api/cuidado-personal-kpi', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) AS total,
        COALESCE(ROUND(AVG(precio_venta)::numeric, 2), 0) AS "tarifaPromedio",
        COUNT(CASE WHEN COALESCE(stock, 0) <= 0 THEN 1 END) AS sinStock,
        COALESCE(
          ROUND(
            (COUNT(CASE WHEN COALESCE(stock, 0) > 0 THEN 1 END) * 100.0) / NULLIF(COUNT(*), 0)::numeric,
            0
          ), 
          0
        ) AS disponibilidad
      FROM cuidado_personal WHERE activo = true
    `);
    res.json({
      tarifaPromedio: parseFloat(result.rows[0].tarifaPromedio) || 0,
      mantenimiento: parseInt(result.rows[0].sinStock) || 0, // mapeado como productos sin stock
      disponibilidad: parseInt(result.rows[0].disponibilidad) || 0
    });
  } catch (error) {
    console.error('--- ERROR EN CUIDADO-PERSONAL-KPI ---', error);
    res.status(500).json({ message: 'Error obteniendo KPI cuidado personal' });
  }
});

// ACTIVIDAD RECIENTE (KARDEX/MOVIMIENTOS REALES DE TU BASE DE DATOS)
app.get('/api/actividad-reciente', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        m.motivo AS nombre,
        UPPER(m.tipo_movimiento) || ' de ' || m.cantidad || ' uds.' AS accion,
        m.tabla_origen AS modulo,
        CASE 
          WHEN m.tabla_origen = 'medicamentos' THEN 'Medicamentos'
          WHEN m.tabla_origen = 'insumos_medicos' THEN 'Insumos Médicos'
          ELSE 'Cuidado Personal'
        END AS "moduloLabel",
        'Hace un momento' AS tiempo
      FROM movimientos_inventario m
      ORDER BY m.fecha DESC
      LIMIT 6
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('ERROR EN ACTIVIDAD RECIENTE:', error);
    res.status(500).json({ message: 'Error obteniendo actividad reciente' });
  }
});

// ALERTAS DE STOCK CRÍTICO AUTOMÁTICAS (Basadas en stock_minimo de cada tabla)
app.get('/api/alertas-stock', async (req, res) => {
  try {
    const medicamentos = await pool.query(`
      SELECT
        nombre_comercial AS nombre,
        'Medicamentos' AS modulo,
        stock,
        CASE WHEN stock = 0 THEN 'critico' ELSE 'bajo' END AS nivel,
        'medication' AS icono
      FROM medicamentos
      WHERE stock <= stock_minimo AND activo = true
    `);

    const insumos = await pool.query(`
      SELECT
        nombre AS nombre,
        'Insumos Médicos' AS modulo,
        stock,
        CASE WHEN stock = 0 THEN 'critico' ELSE 'bajo' END AS nivel,
        'healing' AS icono
      FROM insumos_medicos
      WHERE stock <= stock_minimo AND activo = true
    `);

    const cuidado = await pool.query(`
      SELECT
        nombre AS nombre,
        'Cuidado Personal' AS modulo,
        stock,
        CASE WHEN stock = 0 THEN 'critico' ELSE 'bajo' END AS nivel,
        'clean_hands' AS icono
      FROM cuidado_personal
      WHERE stock <= stock_minimo AND activo = true
    `);

    res.json([...medicamentos.rows, ...insumos.rows, ...cuidado.rows]);
  } catch (error) {
    console.error('ERROR EN ALERTAS:', error);
    res.status(500).json({ message: 'Error obteniendo alertas stock' });
  }
});


// ============================================================
//               1. CRUD - MEDICAMENTOS
// ============================================================
app.get('/api/medicamentos', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM medicamentos WHERE activo = true ORDER BY codigo');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/medicamentos/generar-codigo/:categoria', async (req, res) => {
  try {
    const result = await pool.query("SELECT COALESCE(MAX(CAST(SUBSTRING(codigo FROM '[0-9]+') AS INTEGER)), 0) AS ultimo FROM medicamentos");
    const siguienteNum = (parseInt(result.rows[0].ultimo) + 1);
    const codigo = `MED-${siguienteNum.toString().padStart(4, '0')}`;
    res.json({ codigo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/medicamentos/:codigo', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM medicamentos WHERE codigo=$1 AND activo = true', [req.params.codigo]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/medicamentos', async (req, res) => {
  try {
    const { nombre_comercial, nombre_generico, laboratorio, categoria, presentacion, concentracion, unidad_medida, stock, stock_minimo, precio_compra, precio_venta, lote, fecha_vencimiento, requiere_receta, registro_sanitario, proveedor_id } = req.body;
    
    const countResult = await pool.query("SELECT COALESCE(MAX(CAST(SUBSTRING(codigo FROM '[0-9]+') AS INTEGER)), 0) AS ultimo FROM medicamentos");
    const codigo = `MED-${(parseInt(countResult.rows[0].ultimo) + 1).toString().padStart(4, '0')}`;

    await pool.query(
      `INSERT INTO medicamentos 
      (codigo, nombre_comercial, nombre_generico, laboratorio, categoria, presentacion, concentracion, unidad_medida, stock, stock_minimo, precio_compra, precio_venta, lote, fecha_vencimiento, requiere_receta, registro_sanitario, proveedor_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [codigo, nombre_comercial, nombre_generico, laboratorio, categoria, presentacion, concentracion, unidad_medida || 'unidad', stock || 0, stock_minimo || 10, precio_compra || 0, precio_venta || 0, lote, fecha_vencimiento, requiere_receta || false, registro_sanitario, proveedor_id]
    );
    res.json({ message: "Medicamento creado", codigo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/medicamentos/:codigo', async (req, res) => {
  try {
    const { nombre_comercial, nombre_generico, laboratorio, categoria, presentacion, concentracion, unidad_medida, stock, stock_minimo, precio_compra, precio_venta, lote, fecha_vencimiento, requiere_receta, registro_sanitario, proveedor_id } = req.body;
    await pool.query(
      `UPDATE medicamentos
       SET nombre_comercial=$1, nombre_generico=$2, laboratorio=$3, categoria=$4, presentacion=$5, concentracion=$6, unidad_medida=$7, stock=$8, stock_minimo=$9, precio_compra=$10, precio_venta=$11, lote=$12, fecha_vencimiento=$13, requiere_receta=$14, registro_sanitario=$15, proveedor_id=$16
       WHERE codigo=$17`,
      [nombre_comercial, nombre_generico, laboratorio, categoria, presentacion, concentracion, unidad_medida, stock, stock_minimo, precio_compra, precio_venta, lote, fecha_vencimiento, requiere_receta, registro_sanitario, proveedor_id, req.params.codigo]
    );
    res.json({ message: "Medicamento actualizado" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/medicamentos/:id', async (req, res) => {
  try {
    // Borrado lógico para preservar integridad o físico según desees
    await pool.query('UPDATE medicamentos SET activo = false WHERE id=$1', [req.params.id]);
    res.json({ message: "Medicamento eliminado" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ============================================================
//               2. CRUD - INSUMOS MÉDICOS
// ============================================================
app.get('/api/insumos', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM insumos_medicos WHERE activo = true ORDER BY codigo');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/insumos/generar-codigo', async (req, res) => {
  try {
    const result = await pool.query("SELECT COALESCE(MAX(CAST(SUBSTRING(codigo FROM '[0-9]+') AS INTEGER)), 0) AS ultimo FROM insumos_medicos");
    const codigo = `INS-${(parseInt(result.rows[0].ultimo) + 1).toString().padStart(4, '0')}`;
    res.json({ codigo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/insumos', async (req, res) => {
  try {
    const { nombre, categoria, marca, unidad_medida, stock, stock_minimo, precio_compra, precio_venta, lote, fecha_vencimiento, proveedor_id } = req.body;
    
    const countResult = await pool.query("SELECT COALESCE(MAX(CAST(SUBSTRING(codigo FROM '[0-9]+') AS INTEGER)), 0) AS ultimo FROM insumos_medicos");
    const codigo = `INS-${(parseInt(countResult.rows[0].ultimo) + 1).toString().padStart(4, '0')}`;

    await pool.query(
      `INSERT INTO insumos_medicos 
      (codigo, nombre, categoria, marca, unidad_medida, stock, stock_minimo, precio_compra, precio_venta, lote, fecha_vencimiento, proveedor_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [codigo, nombre, categoria, marca, unidad_medida || 'unidad', stock || 0, stock_minimo || 10, precio_compra || 0, precio_venta || 0, lote, fecha_vencimiento, proveedor_id]
    );
    res.json({ message: "Insumo médico creado", codigo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/insumos/:codigo', async (req, res) => {
  try {
    const { nombre, categoria, marca, unidad_medida, stock, stock_minimo, precio_compra, precio_venta, lote, fecha_vencimiento, proveedor_id } = req.body;
    await pool.query(
      `UPDATE insumos_medicos
       SET nombre=$1, categoria=$2, marca=$3, unidad_medida=$4, stock=$5, stock_minimo=$6, precio_compra=$7, precio_venta=$8, lote=$9, fecha_vencimiento=$10, proveedor_id=$11
       WHERE codigo=$12`,
      [nombre, categoria, marca, unidad_medida, stock, stock_minimo, precio_compra, precio_venta, lote, fecha_vencimiento, proveedor_id, req.params.codigo]
    );
    res.json({ message: "Insumo médico actualizado" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/insumos/:id', async (req, res) => {
  try {
    await pool.query('UPDATE insumos_medicos SET activo = false WHERE id=$1', [req.params.id]);
    res.json({ message: "Insumo eliminado" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ============================================================
//               3. CRUD - CUIDADO PERSONAL
// ============================================================
app.get('/api/cuidado-personal', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM cuidado_personal WHERE activo = true ORDER BY codigo');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/cuidado-personal/generar-codigo', async (req, res) => {
  try {
    const result = await pool.query("SELECT COALESCE(MAX(CAST(SUBSTRING(codigo FROM '[0-9]+') AS INTEGER)), 0) AS ultimo FROM cuidado_personal");
    const codigo = `CP-${(parseInt(result.rows[0].ultimo) + 1).toString().padStart(4, '0')}`;
    res.json({ codigo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/cuidado-personal', async (req, res) => {
  try {
    const { nombre, marca, categoria, unidad_medida, stock, stock_minimo, precio_compra, precio_venta, lote, fecha_vencimiento, proveedor_id } = req.body;
    
    const countResult = await pool.query("SELECT COALESCE(MAX(CAST(SUBSTRING(codigo FROM '[0-9]+') AS INTEGER)), 0) AS ultimo FROM cuidado_personal");
    const codigo = `CP-${(parseInt(countResult.rows[0].ultimo) + 1).toString().padStart(4, '0')}`;

    await pool.query(
      `INSERT INTO cuidado_personal 
      (codigo, nombre, marca, categoria, unidad_medida, stock, stock_minimo, precio_compra, precio_venta, lote, fecha_vencimiento, proveedor_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [codigo, nombre, marca, categoria, unidad_medida || 'unidad', stock || 0, stock_minimo || 10, precio_compra || 0, precio_venta || 0, lote, fecha_vencimiento, proveedor_id]
    );
    res.json({ message: "Producto de cuidado personal creado", codigo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/cuidado-personal/:codigo', async (req, res) => {
  try {
    const { nombre, marca, categoria, unidad_medida, stock, stock_minimo, precio_compra, precio_venta, lote, fecha_vencimiento, proveedor_id } = req.body;
    await pool.query(
      `UPDATE cuidado_personal
       SET nombre=$1, marca=$2, categoria=$3, unidad_medida=$4, stock=$5, stock_minimo=$6, precio_compra=$7, precio_venta=$8, lote=$9, fecha_vencimiento=$10, proveedor_id=$11
       WHERE codigo=$12`,
      [nombre, marca, categoria, unidad_medida, stock, stock_minimo, precio_compra, precio_venta, lote, fecha_vencimiento, proveedor_id, req.params.codigo]
    );
    res.json({ message: "Producto de cuidado personal actualizado" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/cuidado-personal/:id', async (req, res) => {
  try {
    await pool.query('UPDATE cuidado_personal SET activo = false WHERE id=$1', [req.params.id]);
    res.json({ message: "Registro eliminado de cuidado personal" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ============================================================
// ENDPOINTS DE REPORTES
// ============================================================
// FIX: estas rutas usaban `db.query(...)`, pero la conexión en todo
// el archivo se llama `pool`. `db` no existía en ningún lado, así que
// estas 3 rutas explotaban con "ReferenceError: db is not defined"
// en cuanto alguien las llamaba. Se reemplazó `db` por `pool`.

// 1. KPIs del Dashboard
app.get('/api/reportes/dashboard', async (req, res) => {
  try {
    const ventasHoyQuery = `
      SELECT COALESCE(SUM(total), 0) AS total, COUNT(id) AS cantidad 
      FROM ventas WHERE fecha::date = CURRENT_DATE AND estado = 'completada'
    `;

    const stockBajoQuery = `
      SELECT COUNT(*) AS total FROM (
        SELECT id FROM medicamentos WHERE stock < 10
        UNION ALL
        SELECT id FROM insumos_medicos WHERE stock < 10
        UNION ALL
        SELECT id FROM cuidado_personal WHERE stock < 10
      ) AS stock;
    `;

    const porVencerQuery = `
      SELECT COUNT(DISTINCT producto_id) AS total 
      FROM detalle_compra WHERE fecha_vencimiento BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
    `;

    const valorInventarioQuery = `
      SELECT COALESCE(SUM(subtotal), 0) AS total FROM (
        SELECT SUM(stock * precio) AS subtotal FROM medicamentos
        UNION ALL
        SELECT SUM(stock * precio) AS subtotal FROM insumos_medicos
        UNION ALL
        SELECT SUM(stock * precio) AS subtotal FROM cuidado_personal
      ) AS inv;
    `;

    const [ventasHoy, stockBajo, porVencer, valorInventario] = await Promise.all([
      pool.query(ventasHoyQuery),
      pool.query(stockBajoQuery),
      pool.query(porVencerQuery),
      pool.query(valorInventarioQuery)
    ]);

    res.json({
      ventas_hoy: {
        total: parseFloat(ventasHoy.rows[0].total),
        cantidad: parseInt(ventasHoy.rows[0].cantidad)
      },
      productos_stock_bajo: parseInt(stockBajo.rows[0].total),
      productos_por_vencer: parseInt(porVencer.rows[0].total),
      valor_inventario: parseFloat(valorInventario.rows[0].total)
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener KPIs' });
  }
});

// 2. Ventas por periodo
app.get('/api/reportes/ventas', async (req, res) => {
  const { periodo } = req.query;
  let truncPeriod = 'day';
  if (periodo === 'semanal') truncPeriod = 'week';
  if (periodo === 'mensual') truncPeriod = 'month';

  const query = `
    SELECT DATE_TRUNC($1, fecha)::date AS periodo, COUNT(id) AS num_ventas, SUM(total) AS total_ventas
    FROM ventas WHERE estado = 'completada'
    GROUP BY periodo ORDER BY periodo DESC LIMIT 30;
  `;

  try {
    const { rows } = await pool.query(query, [truncPeriod]);
    res.json(rows.map(r => ({
      periodo: r.periodo,
      num_ventas: parseInt(r.num_ventas),
      total_ventas: parseFloat(r.total_ventas)
    })));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener ventas por periodo' });
  }
});

// 3. Rotación de productos
app.get('/api/reportes/rotacion', async (req, res) => {
  const query = `
    WITH ventas_agrupadas AS (
      SELECT tabla_producto, producto_id, SUM(cantidad) AS unidades_vendidas, SUM(subtotal) AS ingresos
      FROM detalle_venta GROUP BY tabla_producto, producto_id
    )
    SELECT m.nombre, 'Medicamentos' AS categoria, v.unidades_vendidas, v.ingresos
    FROM ventas_agrupadas v JOIN medicamentos m ON v.producto_id = m.id AND v.tabla_producto = 'medicamentos'
    UNION ALL
    SELECT i.nombre, 'Insumos Médicos' AS categoria, v.unidades_vendidas, v.ingresos
    FROM ventas_agrupadas v JOIN insumos_medicos i ON v.producto_id = i.id AND v.tabla_producto = 'insumos_medicos'
    UNION ALL
    SELECT c.nombre, 'Cuidado Personal' AS categoria, v.unidades_vendidas, v.ingresos
    FROM ventas_agrupadas v JOIN cuidado_personal c ON v.producto_id = c.id AND v.tabla_producto = 'cuidado_personal'
    ORDER BY unidades_vendidas DESC;
  `;

  try {
    const { rows } = await pool.query(query);
    res.json(rows.map(r => ({
      nombre: r.nombre,
      categoria: r.categoria,
      unidades_vendidas: parseInt(r.unidades_vendidas),
      ingresos: parseFloat(r.ingresos)
    })));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener rotación' });
  }
});

// 1. ENDPOINT PARA OBTENER LOS KPIS DE REPORTES
app.get('/api/reportes/kpis', async (req, res) => {
  try {
    // Ventas de hoy
    const ventasHoyQuery = `
      SELECT COALESCE(COUNT(*), 0) AS total_tx, COALESCE(SUM(total), 0) AS total_monto 
      FROM ventas 
      WHERE DATE(fecha) = CURRENT_DATE
    `;
    
    // Productos con stock bajo (ejemplo: menos de 10 unidades)
    const stockBajoQuery = `
      SELECT COUNT(*) AS total FROM medicamentos WHERE stock <= 10
    `;
    
    // Productos por vencer (ejemplo: menos o igual a 30 días)
    const porVencerQuery = `
      SELECT COUNT(*) AS total FROM medicamentos WHERE fecha_vencimiento <= CURRENT_DATE + INTERVAL '30 days'
    `;

    // Valor total del inventario (precio_compra * stock)
    const valorInventarioQuery = `
      SELECT COALESCE(SUM(precio_compra * stock), 0) AS total FROM medicamentos
    `;

    const [ventasHoy, stockBajo, porVencer, valorInventario] = await Promise.all([
      pool.query(ventasHoyQuery),
      pool.query(stockBajoQuery),
      pool.query(porVencerQuery),
      pool.query(valorInventarioQuery)
    ]);

    return res.json({
      ventas_hoy_tx: parseInt(ventasHoy.rows[0].total_tx),
      ventas_hoy_monto: parseFloat(ventasHoy.rows[0].total_monto),
      stock_bajo: parseInt(stockBajo.rows[0].total),
      por_vencer: parseInt(porVencer.rows[0].total),
      valor_inventario: parseFloat(valorInventario.rows[0].total)
    });

  } catch (err) {
    console.error('Error al obtener KPIs:', err);
    return res.status(500).json({ message: err.message });
  }
});

// 2. ENDPOINT PARA LISTAR TODAS LAS FACTURAS
app.get('/api/ventas/historial', async (req, res) => {
  try {
    // Consulta general trayendo datos del cliente vinculado
    const query = `
      SELECT 
        v.id AS factura_id,
        v.fecha,
        v.total,
        v.metodo_pago,
        c.nombre AS cliente_nombre,
        c.identificacion AS cliente_identificacion
      FROM ventas v
      LEFT JOIN clientes c ON v.cliente_id = c.id
      ORDER BY v.fecha DESC
    `;
    const result = await pool.query(query);
    return res.json(result.rows);
  } catch (err) {
    console.error('Error al obtener historial de ventas:', err);
    return res.status(500).json({ message: err.message });
  }
});

// FIX: se eliminó el `app.listen(...)` que estaba aquí a mitad de
// archivo. Tener DOS app.listen() en el mismo puerto provocaba un
// error EADDRINUSE no controlado que tumbaba el proceso poco después
// de arrancar, dejando sin respuesta a TODOS los endpoints (incluido
// /api/ventas, por eso "Procesar Factura" no hacía nada).


const TABLAS_PRODUCTO = {
  medicamentos: "medicamentos",
  insumos_medicos: "insumos_medicos",
  cuidado_personal: "cuidado_personal"
};

// ============================================================
// CLIENTES
// ============================================================
// Buscar cliente por cédula
app.get('/api/clientes/cedula/:identificacion', async (req, res) => {
  try {

    const identificacion = String(req.params.identificacion)
      .replace(/\D/g, '')
      .trim();

    const result = await pool.query(
      `
      SELECT
          id,
          nombre,
          identificacion,
          telefono,
          correo,
          direccion
      FROM clientes
      WHERE TRIM(identificacion)=TRIM($1)
      LIMIT 1
      `,
      [identificacion]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        encontrado: false,
        mensaje: "Cliente no encontrado"
      });
    }

    return res.json({
      encontrado: true,
      ...result.rows[0]
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      encontrado:false,
      error:error.message
    });
  }
});


// Crear cliente
app.post('/api/clientes', async (req,res)=>{

    try{

        const{
            nombre,
            identificacion,
            telefono,
            correo,
            direccion
        }=req.body;

        const existe=await pool.query(
            `
            SELECT id
            FROM clientes
            WHERE identificacion=$1
            `,
            [identificacion]
        );

        if(existe.rows.length>0){

            return res.status(400).json({
                error:"La cédula ya está registrada."
            });

        }

        const nuevo=await pool.query(

            `
            INSERT INTO clientes
            (
                nombre,
                identificacion,
                telefono,
                correo,
                direccion
            )
            VALUES($1,$2,$3,$4,$5)
            RETURNING *
            `,

            [
                nombre,
                identificacion,
                telefono,
                correo,
                direccion
            ]

        );

        res.status(201).json(nuevo.rows[0]);

    }catch(error){

        console.error(error);

        res.status(500).json({
            error:error.message
        });

    }

});

// ============================================================
// VENTAS
// ============================================================
app.post('/api/ventas', async (req,res)=>{

    const client=await pool.connect();

    try{

        const{

            cliente_id,
            usuario_id,
            metodo_pago,
            subtotal,
            iva,
            total,
            items

        }=req.body;

        if(!usuario_id){

            return res.status(400).json({
                error:"Usuario no enviado."
            });

        }

        if(!items || items.length===0){

            return res.status(400).json({
                error:"No existen productos."
            });

        }

        await client.query("BEGIN");

        //---------------------------------------------------
        // CREAR CABECERA
        //---------------------------------------------------

        const venta=await client.query(

            `
            INSERT INTO ventas
            (
                cliente_id,
                usuario_id,
                subtotal,
                iva,
                total,
                metodo_pago,
                estado,
                fecha
            )

            VALUES
            (
                $1,$2,$3,$4,$5,$6,
                'completada',
                NOW()
            )

            RETURNING id
            `,

            [
                cliente_id || null,
                usuario_id,
                subtotal,
                iva,
                total,
                metodo_pago
            ]

        );

        const venta_id=venta.rows[0].id;

        //---------------------------------------------------
        // DETALLE
        //---------------------------------------------------

        for(const item of items){

            const tabla=TABLAS_PRODUCTO[item.tabla_producto];

            if(!tabla){

                throw new Error("Categoría inválida.");

            }

            //-----------------------------------------
            // Verificar existencia
            //-----------------------------------------

            const producto=await client.query(

                `
                SELECT
                    id,
                    stock,
                    precio_venta
                FROM ${tabla}
                WHERE id=$1
                FOR UPDATE
                `,

                [
                    item.producto_id
                ]

            );

            if(producto.rows.length===0){

                throw new Error("Producto inexistente.");

            }

            const stockActual=Number(producto.rows[0].stock);

            if(stockActual<item.cantidad){

                throw new Error(
                    `Stock insuficiente para ${item.nombre || item.producto_id}`
                );

            }

            //-----------------------------------------
            // Descontar stock
            //-----------------------------------------

            await client.query(

                `
                UPDATE ${tabla}
                SET stock=stock-$1
                WHERE id=$2
                `,

                [
                    item.cantidad,
                    item.producto_id
                ]

            );

            //-----------------------------------------
            // Guardar detalle
            //-----------------------------------------

            await client.query(

                `
                INSERT INTO detalle_venta
                (
                    venta_id,
                    tabla_producto,
                    producto_id,
                    cantidad,
                    precio_unitario,
                    subtotal
                )

                VALUES
                (
                    $1,$2,$3,$4,$5,$6
                )
                `,

                [

                    venta_id,

                    item.tabla_producto,

                    item.producto_id,

                    item.cantidad,

                    item.precio_unitario,

                    item.subtotal

                ]

            );

        }

        //---------------------------------------------
        // Confirmar
        //---------------------------------------------

        await client.query("COMMIT");

        res.status(201).json({

            ok:true,

            venta_id,

            mensaje:"Venta registrada correctamente"

        });

    }

    catch(error){

        await client.query("ROLLBACK");

        console.error(error);

        res.status(400).json({

            ok:false,

            error:error.message

        });

    }

    finally{

        client.release();

    }

});

// ================================================
//           ANULAR VENTA
// ================================================
app.patch('/api/ventas/:id/anular', async (req, res) => {

    const client = await pool.connect();

    try {

        const { id } = req.params;
        const { motivo } = req.body;

        await client.query("BEGIN");

        //-------------------------------------------------
        // Verificar venta
        //-------------------------------------------------

        const venta = await client.query(

            `
            SELECT
                id,
                estado
            FROM ventas
            WHERE id=$1
            FOR UPDATE
            `,
            [id]

        );

        if (venta.rows.length === 0) {

            throw new Error("La venta no existe.");

        }

        if (venta.rows[0].estado === "anulada") {

            throw new Error("La venta ya fue anulada.");

        }

        //-------------------------------------------------
        // Obtener detalle
        //-------------------------------------------------

        const detalle = await client.query(

            `
            SELECT
                tabla_producto,
                producto_id,
                cantidad
            FROM detalle_venta
            WHERE venta_id=$1
            `,
            [id]

        );

        //-------------------------------------------------
        // Reponer stock
        //-------------------------------------------------

        for (const item of detalle.rows) {

            const tabla = TABLAS_PRODUCTO[item.tabla_producto];

            if (!tabla) continue;

            await client.query(

                `
                UPDATE ${tabla}
                SET stock=stock+$1
                WHERE id=$2
                `,

                [
                    item.cantidad,
                    item.producto_id
                ]

            );

        }

        //-------------------------------------------------
        // Actualizar venta
        //-------------------------------------------------

        await client.query(

            `
            UPDATE ventas
            SET
                estado='anulada',
                motivo_anulacion=$1
            WHERE id=$2
            `,

            [
                motivo || null,
                id
            ]

        );

        await client.query("COMMIT");

        res.json({

            ok:true,
            mensaje:"Venta anulada correctamente."

        });

    }

    catch(error){

        await client.query("ROLLBACK");

        console.error(error);

        res.status(400).json({

            ok:false,
            error:error.message

        });

    }

    finally{

        client.release();

    }

});



// ================================================
//           MANEJO DE ERRORES GLOBAL
// ================================================
app.use((err, req, res, next) => {
  console.error('Error global:', err);
  res.status(500).json({ message: 'Error interno del servidor' });
});


// ================================================
//           INICIAR SERVIDOR
// ================================================
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  });
}
module.exports = app;
