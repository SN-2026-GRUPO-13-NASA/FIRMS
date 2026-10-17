// ===========================================================================
// 1. INICIALIZAÇÃO DO MAPA E NAVEGAÇÃO
// ===========================================================================
const map = L.map('map', {
    center: [-14.2350, -51.9253], // Centro da América do Sul / Brasil
    zoom: 4,
    zoomControl: false,           // Desativado por omissão para posicionar no canto superior esquerdo
    dragging: true,               // Permite arrastar o mapa livremente
    scrollWheelZoom: true,        // Zoom com a roda do rato
    doubleClickZoom: true,        // Zoom com duplo clique
    boxZoom: true,
    touchZoom: true               // Navegação por toque
});

// Adiciona os botões de Zoom (+ / -) destacados no canto superior esquerdo
L.control.zoom({
    position: 'topleft'
}).addTo(map);

// Recalcula as dimensões do mapa para prevenir falhas de renderização
setTimeout(() => {
    map.invalidateSize();
}, 300);


// ===========================================================================
// 2. CAMADAS DE MAPA DE FUNDO (TILES)
// ===========================================================================
const tileLayers = {
    dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }),
    satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18 }),
    street: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 })
};

// Define o mapa escuro como padrão
tileLayers.dark.addTo(map);

// Alternador de mapa de fundo no select do menu
document.getElementById('base-map-select').addEventListener('change', (e) => {
    Object.values(tileLayers).forEach(layer => map.removeLayer(layer));
    tileLayers[e.target.value].addTo(map);
});


// ===========================================================================
// 3. VARIÁVEIS GLOBAIS E CAMADAS
// ===========================================================================
let rawData = [];
let selectedDateFilter = null; // null representa todas as datas
let searchLocationMarker = null; // Marcador temporário de pesquisa
let searchDebounceTimeout = null;

// Grupo de Clustering e Camada Ativa Dinâmica
let markersCluster = L.markerClusterGroup({ disableClusteringAtZoom: 9 });
let activeLayerGroup = L.layerGroup().addTo(map);


// ===========================================================================
// 4. FUNÇÕES DE UTILIDADE E CARREGAMENTO DE DADOS
// ===========================================================================

// Retorna a cor do marcador com base na intensidade do FRP
function getMarkerColor(frp) {
    if (frp > 100) return '#f44336'; // Vermelho (Extremo)
    if (frp > 20) return '#ff9800';  // Laranja (Médio)
    return '#ffeb3b';                // Amarelo (Baixo)
}

// Carrega os dados processados do ficheiro JSON
async function loadFireData() {
    try {
        const response = await fetch('data/fires.json');
        const geojson = await response.json();
        rawData = geojson.features;

        document.getElementById('last-update').innerHTML = 
            `<i class="fa-solid fa-circle-check" style="color:#4caf50;"></i> ${rawData.length} focos carregados`;

        setupAvailableDates();
        renderMap();
    } catch (error) {
        document.getElementById('last-update').innerHTML = 
            `<i class="fa-solid fa-triangle-exclamation" style="color:#f44336;"></i> Executar fetch_nasa.py primeiro!`;
    }
}

// Configura os limites min/max no seletor de data
function setupAvailableDates() {
    const dates = rawData.map(f => f.properties.acq_date).filter(Boolean);
    if (dates.length > 0) {
        dates.sort();
        const minDate = dates[0];
        const maxDate = dates[dates.length - 1];
        
        const datePicker = document.getElementById('date-picker');
        datePicker.min = minDate;
        datePicker.max = maxDate;
    }
}


// ===========================================================================
// 5. MOTOR DE RENDERIZAÇÃO E FILTRAGEM DO MAPA
// ===========================================================================
function renderMap() {
    markersCluster.clearLayers();
    activeLayerGroup.clearLayers();

    const showViirs = document.getElementById('layer-viirs').checked;
    const showModis = document.getElementById('layer-modis').checked;
    const useCluster = document.getElementById('layer-cluster').checked;
    const minFrp = parseFloat(document.getElementById('frp-filter').value);
    const confFilter = document.getElementById('confidence-select').value;

    let filteredCount = 0;
    let maxFrp = 0;

    rawData.forEach(feature => {
        const props = feature.properties;
        const [lng, lat] = feature.geometry.coordinates;

        // 1. Filtro por Data
        if (selectedDateFilter && props.acq_date !== selectedDateFilter) return;

        // 2. Filtro por Satélite
        if (!showViirs && props.satellite.includes('VIIRS')) return;
        if (!showModis && props.satellite.includes('MODIS')) return;

        // 3. Filtro por Potência Térmica (FRP)
        if (props.frp < minFrp) return;

        // 4. Filtro por Nível de Confiança
        if (confFilter === 'high' && props.confidence !== 'alta' && props.confidence !== 'high' && props.confidence < 80) return;

        filteredCount++;
        if (props.frp > maxFrp) maxFrp = props.frp;

        // Criação do Marcador Circular
        const color = getMarkerColor(props.frp);
        const marker = L.circleMarker([lat, lng], {
            radius: Math.min(Math.max(props.frp / 10, 5), 12),
            fillColor: color,
            color: '#000',
            weight: 0.5,
            opacity: 0.9,
            fillOpacity: 0.8
        });

        // Popup com Detalhes da Leitura Orbital
        marker.bindPopup(`
            <div style="color: #111;">
                <h4 style="margin-bottom: 5px; color: #d32f2f;"><i class="fa-solid fa-fire"></i> Foco de Calor</h4>
                <b>Satélite:</b> ${props.satellite}<br>
                <b>Data/Hora:</b> ${props.acq_date} ${props.acq_time} UTC<br>
                <b>Potência Térmica (FRP):</b> ${props.frp} MW<br>
                <b>Confiança:</b> ${props.confidence}<br>
                <b>Coordenadas:</b> ${lat.toFixed(4)}, ${lng.toFixed(4)}
            </div>
        `);

        if (useCluster) {
            markersCluster.addLayer(marker);
        } else {
            activeLayerGroup.addLayer(marker);
        }
    });

    if (useCluster) {
        map.addLayer(markersCluster);
    } else {
        map.removeLayer(markersCluster);
    }

    // Atualização dos Painéis de Estatística
    document.getElementById('stat-total').innerText = filteredCount;
    document.getElementById('stat-max-frp').innerText = maxFrp;
    document.getElementById('date-count').innerText = filteredCount;
}


// ===========================================================================
// 6. PESQUISA DE LOCALIDADE POR NOME (GEOCODIFICAÇÃO NOMINATIM)
// ===========================================================================
const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');

if (searchInput) {
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        clearTimeout(searchDebounceTimeout);

        if (query.length < 3) {
            searchResults.classList.remove('active');
            searchResults.innerHTML = '';
            return;
        }

        // Aguarda 400ms sem digitação para efetuar a busca
        searchDebounceTimeout = setTimeout(() => {
            fetchLocationResults(query);
        }, 400);
    });
}

async function fetchLocationResults(query) {
    try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`;
        const response = await fetch(url, {
            headers: { 'User-Agent': 'FIRMS-Fire-Panel/1.0' }
        });
        const results = await response.json();
        renderSearchResults(results);
    } catch (error) {
        console.error("Erro na busca de localidade:", error);
    }
}

function renderSearchResults(results) {
    searchResults.innerHTML = '';

    if (results.length === 0) {
        searchResults.innerHTML = `<li class="search-result-item"><i class="fa-solid fa-circle-xmark"></i> Nenhum local encontrado</li>`;
        searchResults.classList.add('active');
        return;
    }

    results.forEach(place => {
        const li = document.createElement('li');
        li.className = 'search-result-item';
        li.innerHTML = `<i class="fa-solid fa-location-dot" style="color: #ff5722;"></i> <span>${place.display_name}</span>`;

        li.addEventListener('click', () => {
            const lat = parseFloat(place.lat);
            const lon = parseFloat(place.lon);

            // Animação de voo suave até à posição
            map.flyTo([lat, lon], 10, { duration: 1.5 });

            if (searchLocationMarker) {
                map.removeLayer(searchLocationMarker);
            }

            searchLocationMarker = L.marker([lat, lon])
                .addTo(map)
                .bindPopup(`<b>${place.display_name}</b>`)
                .openPopup();

            searchInput.value = place.display_name.split(',')[0];
            searchResults.classList.remove('active');
        });

        searchResults.appendChild(li);
    });

    searchResults.classList.add('active');
}

document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-container')) {
        searchResults.classList.remove('active');
    }
});


// ===========================================================================
// 7. GESTÃO DOS MODAIS E DRAWER DE CALENDÁRIO
// ===========================================================================
const calendarDrawer = document.getElementById('calendar-drawer');
const infoModal = document.getElementById('info-modal');
const overlay = document.getElementById('overlay');

// Controlo do Drawer do Calendário
document.getElementById('btn-open-calendar').addEventListener('click', () => {
    calendarDrawer.classList.add('open');
    overlay.classList.add('open');
});

document.getElementById('btn-close-calendar').addEventListener('click', closeAllPopups);

// Controlo do Modal de Informação
document.getElementById('btn-open-info').addEventListener('click', () => {
    infoModal.classList.add('open');
});

document.getElementById('btn-close-info').addEventListener('click', () => {
    infoModal.classList.remove('open');
});

overlay.addEventListener('click', closeAllPopups);

function closeAllPopups() {
    if (calendarDrawer) calendarDrawer.classList.remove('open');
    if (overlay) overlay.classList.remove('open');
}

// Ações do Seletor de Data
const datePicker = document.getElementById('date-picker');
const badge = document.getElementById('selected-date-badge');

if (datePicker) {
    datePicker.addEventListener('change', (e) => {
        selectedDateFilter = e.target.value;
        badge.innerText = selectedDateFilter;
        document.querySelectorAll('.btn-preset').forEach(b => b.classList.remove('active'));
        renderMap();
    });
}

document.getElementById('btn-date-today').addEventListener('click', () => {
    const dates = rawData.map(f => f.properties.acq_date).filter(Boolean);
    if (dates.length > 0) {
        dates.sort();
        selectedDateFilter = dates[dates.length - 1]; // Pega na data mais recente carregada
        datePicker.value = selectedDateFilter;
        badge.innerText = selectedDateFilter;
    }
    setActivePreset('btn-date-today');
    renderMap();
});

document.getElementById('btn-date-all').addEventListener('click', () => {
    selectedDateFilter = null;
    if (datePicker) datePicker.value = '';
    badge.innerText = 'Todas';
    setActivePreset('btn-date-all');
    renderMap();
});

function setActivePreset(id) {
    document.querySelectorAll('.btn-preset').forEach(b => b.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}


// ===========================================================================
// 8. EVENT LISTENERS DOS FILTROS E CONTROLOS DAS CAMADAS
// ===========================================================================
document.getElementById('layer-viirs').addEventListener('change', renderMap);
document.getElementById('layer-modis').addEventListener('change', renderMap);
document.getElementById('layer-cluster').addEventListener('change', renderMap);
document.getElementById('confidence-select').addEventListener('change', renderMap);

const frpSlider = document.getElementById('frp-filter');
frpSlider.addEventListener('input', (e) => {
    document.getElementById('frp-value').innerText = `${e.target.value} MW`;
    renderMap();
});


// ===========================================================================
// 9. EXECUÇÃO INICIAL
// ===========================================================================
loadFireData();