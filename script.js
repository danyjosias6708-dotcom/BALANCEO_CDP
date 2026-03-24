// ============================================
// BALANCEO CDP - ANÁLISIS TOC/LEAN
// ============================================

let datosOriginal = null;
let datosAnalisis = null;

// ============ FUNCIONES PRINCIPALES ============

function parsearCSV(texto) {
    const lineas = texto.trim().split('\n');
    const datos = [];
    
    for (let i = 0; i < lineas.length; i++) {
        const fila = lineas[i].split(';').map(v => v.trim());
        if (fila.length > 1 && fila[0] && !fila[0].includes('EFICIENCIA DE')) {
            datos.push(fila);
        }
    }
    
    return datos;
}

function extraerDatos(datos) {
    const headers = datos[0];
    const celulas = [];
    
    for (let i = 1; i < datos.length; i++) {
        const fila = datos[i];
        if (fila[0].includes('CELULA')) {
            const celula = {
                nombre: fila[0],
                operaciones: {},
                docenas9h: parseFloat(fila[12]) || 0,
                docenasHora: parseFloat(fila[13]) || 0
            };
            
            for (let j = 1; j <= 10; j++) {
                const valor = fila[j].replace('%', '');
                celula.operaciones[`OP-0${j}`] = parseFloat(valor) || 0;
            }
            
            celulas.push(celula);
        }
    }
    
    return celulas;
}

function diagnosticoASIS(celulas) {
    const resultado = {
        celulas: [],
        metricas: {
            minGlobal: 100,
            maxGlobal: 0,
            promedio: 0
        }
    };
    
    let sumaEficiencias = 0;
    let totalValores = 0;
    
    celulas.forEach(celula => {
        const eficiencias = Object.values(celula.operaciones);
        const minEficiencia = Math.min(...eficiencias);
        const maxEficiencia = Math.max(...eficiencias);
        const rango = maxEficiencia - minEficiencia;
        
        // Identificar cuello de botella
        let cuelloBottella = null;
        let minOp = 100;
        for (const [op, eff] of Object.entries(celula.operaciones)) {
            if (eff < minOp) {
                minOp = eff;
                cuelloBottella = op;
            }
        }
        
        // Clasificar operaciones
        const clasificacion = {};
        Object.entries(celula.operaciones).forEach(([op, eff]) => {
            if (eff > 100) {
                clasificacion[op] = 'SOBREASIGNADA';
            } else if (eff >= 80 && eff <= 100) {
                clasificacion[op] = 'ESTÁNDAR';
            } else if (eff < 80) {
                clasificacion[op] = 'CRÍTICA';
            }
        });
        
        resultado.celulas.push({
            nombre: celula.nombre,
            eficiencias: celula.operaciones,
            min: minEficiencia,
            max: maxEficiencia,
            rango: rango,
            cuelloBottella: cuelloBottella,
            clasificacion: clasificacion,
            docenas9h: celula.docenas9h,
            docenasHora: celula.docenasHora
        });
        
        sumaEficiencias += minEficiencia;
        totalValores++;
        resultado.metricas.minGlobal = Math.min(resultado.metricas.minGlobal, minEficiencia);
        resultado.metricas.maxGlobal = Math.max(resultado.metricas.maxGlobal, maxEficiencia);
    });
    
    resultado.metricas.promedio = (sumaEficiencias / totalValores).toFixed(2);
    resultado.metricas.throughputModulo = calcularThroughput(resultado.celulas);
    
    return resultado;
}

function calcularThroughput(celulas) {
    let throughputTotal = 0;
    celulas.forEach(c => {
        // Throughput limitado por cuello de botella
        const eficienciaMinima = c.min;
        const capacidadDisponible = 100; // % de capacidad
        const throughput = (eficienciaMinima / 100) * capacidadDisponible;
        throughputTotal += throughput;
    });
    return (throughputTotal / celulas.length).toFixed(2);
}

function analizarMovimientos(diagnostico) {
    const movimientos = [];
    const celulasOrdenadas = [...diagnostico.celulas].sort((a, b) => a.min - b.min);
    
    // Identificar cuellos críticos (mín < 80%)
    const cuellasCríticos = celulasOrdenadas.filter(c => c.min < 80);
    
    cuellasCríticos.forEach((celula, index) => {
        // Buscar operaciones sobreasignadas en la misma célula
        const sobreasignadas = Object.entries(celula.clasificacion)
            .filter(([op, clase]) => clase === 'SOBREASIGNADA');
        
        sobreasignadas.forEach(([opOrigen, _]) => {
            const movimiento = {
                numero: `MOV-${String(movimientos.length + 1).padStart(3, '0')}`,
                personal: `Capacidad ${opOrigen}`,
                origen: `${opOrigen}, ${celula.nombre}`,
                destino: `${celula.cuelloBottella}, ${celula.nombre}`,
                tipoMovimiento: 'Intracelular',
                impactoEsperado: `+${(celula.operaciones[opOrigen] - celula.min).toFixed(2)}%`,
                justificacion: 'TOC: Explotar la restricción - Reasignar capacidad excedente'
            };
            movimientos.push(movimiento);
        });
    });
    
    return {
        movimientos: movimientos.slice(0, 5), // Máximo 5 movimientos
        totalMovimientos: movimientos.length,
        impactoEstimado: `${(movimientos.length * 2.5).toFixed(2)}% mejora en throughput`
    };
}

function optimizarTO_BE(diagnostico, movimientos) {
    const celulasOptimizadas = [];
    
    diagnostico.celulas.forEach(celula => {
        const optimizada = JSON.parse(JSON.stringify(celula));
        
        // Aplicar movimientos a esta célula
        movimientos.movimientos.forEach(mov => {
            if (mov.origen.includes(celula.nombre)) {
                // Aumentar eficiencia del cuello de botella en 3%
                const opDestino = mov.destino.split(',')[0];
                if (optimizada.eficiencias[opDestino]) {
                    optimizada.eficiencias[opDestino] += 3;
                }
                // Disminuir eficiencia de origen en 2%
                const opOrigen = mov.origen.split(',')[0];
                if (optimizada.eficiencias[opOrigen]) {
                    optimizada.eficiencias[opOrigen] -= 2;
                }
            }
        });
        
        // Recalcular métricas
        const eficienciasNuevas = Object.values(optimizada.eficiencias);
        optimizada.minNuevo = Math.min(...eficienciasNuevas);
        optimizada.maxNuevo = Math.max(...eficienciasNuevas);
        optimizada.rangoNuevo = optimizada.maxNuevo - optimizada.minNuevo;
        
        optimizada.deltaMejora = ((optimizada.minNuevo - optimizada.min) / optimizada.min * 100).toFixed(2);
        
        celulasOptimizadas.push(optimizada);
    });
    
    return celulasOptimizadas;
}

function calcularKPIs(diagnostico, optimizado) {
    const minPromedioDiag = diagnostico.celulas.reduce((a, b) => a + b.min, 0) / diagnostico.celulas.length;
    const minPromedioOpt = optimizado.reduce((a, b) => a + b.minNuevo, 0) / optimizado.length;
    
    const rangoPromedioDiag = diagnostico.celulas.reduce((a, b) => a + b.rango, 0) / diagnostico.celulas.length;
    const rangoPromedioOpt = optimizado.reduce((a, b) => a + b.rangoNuevo, 0) / optimizado.length;
    
    const incrementoOutput = (((minPromedioOpt - minPromedioDiag) / minPromedioDiag) * 100).toFixed(2);
    const reduccionVariabilidad = (((rangoPromedioDiag - rangoPromedioOpt) / rangoPromedioDiag) * 100).toFixed(2);
    
    const celulasConMejora = optimizado.filter(c => c.minNuevo > c.min).length;
    
    return {
        incrementoOutput: incrementoOutput,
        reduccionVariabilidad: reduccionVariabilidad,
        celulasConMejora: celulasConMejora,
        totalCelulas: optimizado.length,
        eficienciaModuloAS_IS: diagnostico.metricas.promedio,
        eficienciaModuloTO_BE: minPromedioOpt.toFixed(2),
        movimientosRealizados: datosAnalisis ? datosAnalisis.movimientos.movimientos.length : 0
    };
}

// ============ RENDERIZACIÓN ============

function renderizarDiagnostico(diagnostico) {
    let html = '<h3>Tabla Diagnóstica Maestra (AS-IS)</h3>';
    html += '<table><thead><tr><th>Célula</th>';
    
    for (let i = 1; i <= 10; i++) {
        html += `<th>OP-0${i}</th>`;
    }
    
    html += '<th>Mín (CB)</th><th>Máx</th><th>Rango</th><th>Doz/9h</th></tr></thead><tbody>';
    
    diagnostico.celulas.forEach(c => {
        html += `<tr><td><strong>${c.nombre}</strong></td>`;
        
        for (let i = 1; i <= 10; i++) {
            const op = `OP-0${i}`;
            const valor = c.eficiencias[op];
            let clase = '';
            
            if (valor > 100) clase = 'amarillo';
            else if (valor < 80) clase = 'rojo';
            else if (op === c.cuelloBottella) clase = 'rojo';
            else clase = 'verde';
            
            html += `<td class="${clase}">${valor.toFixed(1)}%</td>`;
        }
        
        html += `<td class="rojo"><strong>${c.min.toFixed(1)}%</strong><br/>(${c.cuelloBottella})</td>`;
        html += `<td>${c.max.toFixed(1)}%</td>`;
        html += `<td>${c.rango.toFixed(1)}%</td>`;
        html += `<td>${c.docenas9h}</td></tr>`;
    });
    
    html += '</tbody></table>';
    
    html += '<div class="metric-grid">';
    html += `<div class="metric-card"><div class="metric-label">Eficiencia Mínima Promedio</div><div class="metric-value">${diagnostico.metricas.promedio}%</div></div>`;
    html += `<div class="metric-card"><div class="metric-label">Mínimo Global</div><div class="metric-value">${diagnostico.metricas.minGlobal.toFixed(1)}%</div></div>`;
    html += `<div class="metric-card"><div class="metric-label">Máximo Global</div><div class="metric-value">${diagnostico.metricas.maxGlobal.toFixed(1)}%</div></div>`;
    html += `<div class="metric-card"><div class="metric-label">Throughput Módulo</div><div class="metric-value">${diagnostico.metricas.throughputModulo}%</div></div>`;
    html += '</div>';
    
    return html;
}

function renderizarMovimientos(movimientos) {
    let html = '<h3>Registro de Movimientos de Balanceo (TOC)</h3>';
    html += `<p><strong>Total de movimientos recomendados:</strong> ${movimientos.totalMovimientos}</p>`;
    html += `<p><strong>Impacto estimado:</strong> ${movimientos.impactoEstimado}</p>`;
    
    if (movimientos.movimientos.length === 0) {
        html += '<p style="color: #22543d; background: #c6f6d5; padding: 12px; border-radius: 6px;">✅ Sistema balanceado - No se requieren movimientos.</p>';
    } else {
        html += '<table><thead><tr><th>#</th><th>Origen</th><th>Destino</th><th>Tipo</th><th>Impacto</th><th>Justificación</th></tr></thead><tbody>';
        
        movimientos.movimientos.forEach((mov, i) => {
            html += `<tr>
                <td><strong>${mov.numero}</strong></td>
                <td>${mov.origen}</td>
                <td>${mov.destino}</td>
                <td>${mov.tipoMovimiento}</td>
                <td class="amarillo">${mov.impactoEsperado}</td>
                <td>${mov.justificacion}</td>
            </tr>`;
        });
        
        html += '</tbody></table>';
    }
    
    return html;
}

function renderizarOptimizado(optimizado) {
    let html = '<h3>Tabla Optimizada (TO-BE)</h3>';
    html += '<table><thead><tr><th>Célula</th>';
    
    for (let i = 1; i <= 10; i++) {
        html += `<th>OP-0${i}</th>`;
    }
    
    html += '<th>Mín Nuevo</th><th>Máx Nuevo</th><th>Δ Mejora</th></tr></thead><tbody>';
    
    optimizado.forEach(c => {
        html += `<tr><td><strong>${c.nombre}</strong></td>`;
        
        for (let i = 1; i <= 10; i++) {
            const op = `OP-0${i}`;
            const valor = c.eficiencias[op];
            let clase = '';
            
            if (valor > 100) clase = 'amarillo';
            else if (valor < 80) clase = 'rojo';
            else clase = 'verde';
            
            html += `<td class="${clase}">${valor.toFixed(1)}%</td>`;
        }
        
        const deltaColor = c.deltaMejora > 0 ? 'verde' : 'rojo';
        html += `<td class="verde"><strong>${c.minNuevo.toFixed(1)}%</strong></td>`;
        html += `<td>${c.maxNuevo.toFixed(1)}%</td>`;
        html += `<td class="${deltaColor}">${c.deltaMejora}%</td></tr>`;
    });
    
    html += '</tbody></table>';
    
    return html;
}

function renderizarKPIs(kpis) {
    let html = '<h3>Impacto Cuantificado del Balanceo</h3>';
    html += '<table><thead><tr><th>KPI</th><th>AS-IS</th><th>TO-BE</th><th>Mejora</th></tr></thead><tbody>';
    
    html += `<tr>
        <td><strong>Eficiencia Módulo (%)</strong></td>
        <td>${kpis.eficienciaModuloAS_IS}%</td>
        <td>${kpis.eficienciaModuloTO_BE}%</td>
        <td class="verde"><strong>+${(kpis.eficienciaModuloTO_BE - kpis.eficienciaModuloAS_IS).toFixed(2)}%</strong></td>
    </tr>`;
    
    html += `<tr>
        <td><strong>Incremento Output Real (%)</strong></td>
        <td>—</td>
        <td>—</td>
        <td class="verde"><strong>${kpis.incrementoOutput}%</strong></td>
    </tr>`;
    
    html += `<tr>
        <td><strong>Reducción Variabilidad (%)</strong></td>
        <td>—</td>
        <td>—</td>
        <td class="verde"><strong>${kpis.reduccionVariabilidad}%</strong></td>
    </tr>`;
    
    html += `<tr>
        <td><strong>Células con Mejora</strong></td>
        <td>—</td>
        <td>—</td>
        <td class="verde"><strong>${kpis.celulasConMejora} de ${kpis.totalCelulas}</strong></td>
    </tr>`;
    
    html += `<tr>
        <td><strong>Movimientos Realizados</strong></td>
        <td>—</td>
        <td>—</td>
        <td><strong>${kpis.movimientosRealizados}</strong></td>
    </tr>`;
    
    html += '</tbody></table>';
    
    return html;
}

// ============ EVENT LISTENERS ============

document.getElementById('btnCargar').addEventListener('click', function() {
    const file = document.getElementById('csvFile').files[0];
    if (!file) {
        mostrarStatus('Por favor selecciona un archivo CSV', 'error');
        return;
    }
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const texto = e.target.result;
            const datosParsed = parsearCSV(texto);
            const celulas = extraerDatos(datosParsed);
            
            if (celulas.length === 0) {
                throw new Error('No se encontraron datos de células');
            }
            
            datosOriginal = celulas;
            
            // Mostrar preview
            mostrarPreview(datosParsed);
            mostrarStatus(`✅ CSV cargado correctamente. ${celulas.length} células detectadas.`, 'success');
            
            // Habilitar botón de balanceo
            document.getElementById('btnBalancear').style.display = 'inline-block';
            document.getElementById('btnDescargarExcel').style.display = 'inline-block';
            
        } catch (error) {
            mostrarStatus(`❌ Error al procesar CSV: ${error.message}`, 'error');
        }
    };
    reader.readAsText(file);
});

document.getElementById('btnBalancear').addEventListener('click', function() {
    if (!datosOriginal) return;
    
    try {
        // Ejecutar análisis completo
        const diagnostico = diagnosticoASIS(datosOriginal);
        const movimientos = analizarMovimientos(diagnostico);
        const optimizado = optimizarTO_BE(diagnostico, movimientos);
        const kpis = calcularKPIs(diagnostico, optimizado);
        
        datosAnalisis = {
            diagnostico,
            movimientos,
            optimizado,
            kpis
        };
        
        // Renderizar en tabs
        document.getElementById('diagnosticoContent').innerHTML = renderizarDiagnostico(diagnostico);
        document.getElementById('movimientosContent').innerHTML = renderizarMovimientos(movimientos);
        document.getElementById('optimizadoContent').innerHTML = renderizarOptimizado(optimizado);
        document.getElementById('kpiContent').innerHTML = renderizarKPIs(kpis);
        
        mostrarStatus('✅ Balanceo completado exitosamente', 'success');
        
        // Cambiar a tab de diagnóstico
        cambiarTab('diagnostico');
        
    } catch (error) {
        mostrarStatus(`❌ Error en análisis: ${error.message}`, 'error');
    }
});

document.getElementById('btnDescargarExcel').addEventListener('click', function() {
    if (!datosAnalisis) {
        mostrarStatus('Ejecuta el balanceo primero', 'error');
        return;
    }
    alert('Función de descarga Excel en desarrollo.\n\nDatos disponibles:\n- Diagnóstico AS-IS\n- Movimientos\n- Configuración TO-BE\n- KPIs');
});

document.getElementById('btnLimpiar').addEventListener('click', function() {
    datosOriginal = null;
    datosAnalisis = null;
    document.getElementById('csvFile').value = '';
    document.getElementById('statusMessage').innerHTML = '';
    document.getElementById('datosPreview').style.display = 'none';
    document.getElementById('diagnosticoContent').innerHTML = '<p>Carga un CSV primero.</p>';
    document.getElementById('movimientosContent').innerHTML = '<p>Carga un CSV primero.</p>';
    document.getElementById('optimizadoContent').innerHTML = '<p>Carga un CSV primero.</p>';
    document.getElementById('kpiContent').innerHTML = '<p>Carga un CSV primero.</p>';
    document.getElementById('btnBalancear').style.display = 'none';
    document.getElementById('btnDescargarExcel').style.display = 'none';
    mostrarStatus('✅ Datos limpios', 'success');
});

// Gestión de tabs
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', function() {
        const tabName = this.getAttribute('data-tab');
        cambiarTab(tabName);
    });
});

function cambiarTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    
    document.getElementById(tabName).classList.add('active');
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
}

function mostrarStatus(mensaje, tipo) {
    const elem = document.getElementById('statusMessage');
    elem.textContent = mensaje;
    elem.className = 'status ' + tipo;
}

function mostrarPreview(datos) {
    const preview = document.getElementById('tablePreview');
    let html = '<table><thead><tr>';
    
    datos[0].forEach(h => html += `<th>${h}</th>`);
    html += '</tr></thead><tbody>';
    
    for (let i = 1; i < Math.min(datos.length, 6); i++) {
        html += '<tr>';
        datos[i].forEach(cell => html += `<td>${cell}</td>`);
        html += '</tr>';
    }
    
    html += '</tbody></table>';
    preview.innerHTML = html;
    document.getElementById('datosPreview').style.display = 'block';
}
