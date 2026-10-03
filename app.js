// Configurações do Supabase do Projeto Grupo 13
const SUPABASE_URL = "https://mnedtkhjfaygtvoaxfka.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_aw0HvUP7GyAU3nnwP0N4oA_UJuMmw6k";      // Cole a chave anon

let allData = [];
let filteredData = [];

// Função de Sanitização (XSS Protection - Obrigatório no Edital)
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Inicialização da Aplicação
document.addEventListener('DOMContentLoaded', () => {
    initEvents();
    fetchPipelineStatus();
    fetchFireData();
});

function initEvents() {
    document.getElementById('btn-refresh').addEventListener('click', () => {
        fetchPipelineStatus();
        fetchFireData();
    });

    document.getElementById('filter-satellite').addEventListener('change', applyFilters);
    document.getElementById('filter-frp').addEventListener('input', (e) => {
        document.getElementById('frp-val').innerText = e.target.value;
        applyFilters();
    });
    document.getElementById('filter-search').addEventListener('input', applyFilters);
    document.getElementById('btn-reset-filters').addEventListener('click', resetFilters);
}

// Buscar Último Status de Execução
async function fetchPipelineStatus() {
    const dot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');

    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/execucoes?select=data_execucao,status&order=data_execucao.desc&limit=1`, {
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
            }
        });

        if (!res.ok) throw new Error('Falha na resposta');
        const logs = await res.json();

        if (logs.length > 0) {
            const last = logs[0];
            const date = new Date(last.data_execucao).toLocaleString('pt-BR');
            dot.className = `status-dot ${last.status === 'concluido' ? 'online' : 'error'}`;
            statusText.innerText = `Pipeline: ${last.status} (${date})`;
        } else {
            statusText.innerText = 'Sem histórico de execuções.';
        }
    } catch (err) {
        dot.className = 'status-dot error';
        statusText.innerText = 'Status: Não conectado ao Supabase';
        loadMockData(); // Carrega dados de demonstração em caso de erro na chave
    }
}

// Buscar Dados de Focos de Incêndio
async function fetchFireData() {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/firms_data?select=*&order=acq_date.desc,acq_time.desc&limit=100`, {
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
            }
        });

        if (!res.ok) throw new Error('Erro na requisição');
        allData = await res.json();
        applyFilters();
    } catch (err) {
        if (allData.length === 0) {
            loadMockData();
        }
    }
}

// Dados de Demonstração (Fallback)
function loadMockData() {
    allData = [
        { acq_date: "2026-03-28", acq_time: "17:45", latitude: -15.7801, longitude: -47.9292, satellite: "VIIRS_SNPP", confidence: "92", frp: 185.4 },
        { acq_date: "2026-03-28", acq_time: "16:30", latitude: -12.9714, longitude: -38.5014, satellite: "MODIS_Aqua", confidence: "85", frp: 62.1 },
        { acq_date: "2026-03-28", acq_time: "14:15", latitude: -22.9068, longitude: -43.1729, satellite: "VIIRS_NOAA20", confidence: "98", frp: 240.0 },
        { acq_date: "2026-03-27", acq_time: "20:00", latitude: -3.7319, longitude: -38.5267, satellite: "MODIS_Terra", confidence: "74", frp: 35.8 },
        { acq_date: "2026-03-27", acq_time: "18:22", latitude: -30.0346, longitude: -51.2177, satellite: "VIIRS_SNPP", confidence: "90", frp: 120.5 }
    ];
    applyFilters();
}

// Filtros
function applyFilters() {
    const satValue = document.getElementById('filter-satellite').value;
    const frpValue = parseFloat(document.getElementById('filter-frp').value);
    const searchValue = document.getElementById('filter-search').value.toLowerCase().trim();

    filteredData = allData.filter(item => {
        const matchesSat = satValue === 'ALL' || (item.satellite && item.satellite.includes(satValue));
        const matchesFrp = (item.frp || 0) >= frpValue;
        const matchesSearch = !searchValue || 
            item.acq_date.includes(searchValue) || 
            String(item.latitude).includes(searchValue) || 
            String(item.longitude).includes(searchValue);

        return matchesSat && matchesFrp && matchesSearch;
    });

    updateKPIs(filteredData);
    renderTable(filteredData);
    renderCanvasMap(filteredData);
}

function resetFilters() {
    document.getElementById('filter-satellite').value = 'ALL';
    document.getElementById('filter-frp').value = 0;
    document.getElementById('frp-val').innerText = '0';
    document.getElementById('filter-search').value = '';
    applyFilters();
}

// Atualizar Cartões de Métricas (KPIs)
function updateKPIs(data) {
    document.getElementById('kpi-total').innerText = data.length;

    if (data.length === 0) {
        document.getElementById('kpi-max-frp').innerHTML = '0.0 <small>MW</small>';
        document.getElementById('kpi-sat').innerText = '--';
        document.getElementById('kpi-conf').innerText = '0%';
        return;
    }

    const maxFrp = Math.max(...data.map(d => d.frp || 0));
    document.getElementById('kpi-max-frp').innerHTML = `${maxFrp.toFixed(1)} <small>MW</small>`;

    const satCounts = {};
    let totalConf = 0;

    data.forEach(d => {
        const sat = d.satellite || 'Outros';
        satCounts[sat] = (satCounts[sat] || 0) + 1;
        totalConf += parseFloat(d.confidence || 0);
    });

    const topSat = Object.keys(satCounts).reduce((a, b) => satCounts[a] > satCounts[b] ? a : b, '--');
    document.getElementById('kpi-sat').innerText = topSat.replace('VIIRS_', '');
    document.getElementById('kpi-conf').innerText = `${Math.round(totalConf / data.length)}%`;
}

// Renderizar Tabela
function renderTable(data) {
    const tbody = document.getElementById('table-body');
    document.getElementById('table-count').innerText = `Exibindo ${data.length} registros`;

    if (data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center">Nenhum foco de incêndio encontrado com os filtros aplicados.</td></tr>`;
        return;
    }

    tbody.innerHTML = data.map(row => `
        <tr>
            <td class="text-left">${escapeHtml(row.acq_date)}</td>
            <td class="text-left">${escapeHtml(row.acq_time)}</td>
            <td class="text-right">${escapeHtml(row.latitude)}</td>
            <td class="text-right">${escapeHtml(row.longitude)}</td>
            <td class="text-left"><span class="badge badge-sat">${escapeHtml(row.satellite)}</span></td>
            <td class="text-center"><span class="badge badge-conf">${escapeHtml(row.confidence)}%</span></td>
            <td class="text-right"><strong>${escapeHtml(row.frp)}</strong></td>
        </tr>
    `).join('');
}

// Renderizar Mapa Canvas Simulado
function renderCanvasMap(data) {
    const canvas = document.getElementById('fire-map');
    const ctx = canvas.getContext('2d');
    
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Desenhar Grid Fundo
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    for (let x = 0; x < canvas.width; x += 40) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += 40) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
    }

    // Plotar Focos
    data.forEach(item => {
        // Mapeamento simplificado de lat/long para tela
        const x = ((parseFloat(item.longitude) + 80) / 50) * canvas.width;
        const y = ((10 - parseFloat(item.latitude)) / 50) * canvas.height;

        const frp = item.frp || 0;
        let color = '#f59e0b';
        if (frp > 50) color = '#f97316';
        if (frp > 150) color = '#ef4444';

        ctx.beginPath();
        ctx.arc(x, y, Math.min(Math.max(frp / 20, 4), 12), 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.shadowBlur = 0;
    });
}