const apiUrl = 'https://script.google.com/macros/s/AKfycbyRS9sMWDZHsX9Y0Oft_NrOghlKzK1lAVgb5L_W1fKYdPDclcyqOFhqWplreWPSRO3LMQ/exec';

let entities = [];
let entityToId = {};
let rollupData = [];
let contrastData = [];
let rawPivotData = [];
let dataLoaded = false;

const CACHE_DURATION_MS = 60 * 60 * 1000;

function getCachedSheet(sheetName) {
  const cached = localStorage.getItem(sheetName);
  if (!cached) return null;
  const { timestamp, data } = JSON.parse(cached);
  if (Date.now() - timestamp > CACHE_DURATION_MS) {
    localStorage.removeItem(sheetName);
    return null;
  }
  return data;
}

function cacheSheet(sheetName, data) {
  localStorage.setItem(sheetName, JSON.stringify({ timestamp: Date.now(), data }));
}

function showError(message) {
  const box = document.getElementById('error-message');
  if (box) {
    box.textContent = message;
    box.style.display = 'block';
  } else {
    alert(message);
  }
}

function setLoading(isLoading) {
  const spinner = document.getElementById('loading-spinner');
  if (spinner) spinner.style.display = isLoading ? 'block' : 'none';
}

function processEntities(rows) {
  const primaryEntities = rows.filter(row => row['ModelGroup']?.toString().trim() === 'Primary');
  entities = [...new Set(primaryEntities.map(row => row['Entity Name']?.toString().trim()))].sort();
  entityToId = primaryEntities.reduce((acc, row) => {
    const idKey = ['EntID', 'ent_id', 'ID'].find(key => row[key] !== undefined);
    if (idKey && row['Entity Name']) {
      acc[row['Entity Name'].toString().trim()] = parseInt(row[idKey]);
    }
    return acc;
  }, {});
  populateDropdownsFromRows(primaryEntities);
  dataLoaded = true;
  updateSimilarity();
}

const cachedEntities = getCachedSheet('Entities');
if (cachedEntities) {
  processEntities(cachedEntities);
} else {
  setLoading(true);
  fetch(`${apiUrl}?sheet=Entities`)
    .then(response => response.json())
    .then(result => {
      if (result.success) {
        cacheSheet('Entities', result.rows);
        processEntities(result.rows);
      } else {
        showError('Error fetching entities: ' + result.error);
      }
    })
    .catch(error => showError('Fetch error for Entities: ' + error))
    .finally(() => setLoading(false));
}

Promise.all([
  fetch(`${apiUrl}?sheet=RollUpScores`).then(r => r.json()),
  fetch(`${apiUrl}?sheet=ContrastScores`).then(r => r.json()),
  fetch(`${apiUrl}?sheet=RawScorePivot`).then(r => r.json())
])
  .then(([rollup, contrast, rawPivot]) => {
    if (rollup.success) rollupData = rollup.rows;
    if (contrast.success) contrastData = contrast.rows;
    if (rawPivot.success) rawPivotData = rawPivot.rows;
  })
  .catch(error => showError('Error loading chart data: ' + error))
  .finally(() => {
    dataLoaded = true;
    updateSimilarity();
    updateCharts();
  });

function populateDropdownsFromRows(rows) {
  const select1 = d3.select('#entity-select1');
  const select2 = d3.select('#entity-select2');

  select1.selectAll('*').remove();
  select2.selectAll('*').remove();

  const filtered = rows.filter(row => row['ModelGroup']?.toString().trim() === 'Primary');
  const grouped = d3.group(filtered, d => d['Entity Type'] || 'Other');

  function populateSelect(select) {
    for (const [type, items] of grouped) {
      const optgroup = select.append('optgroup').attr('label', type);
      optgroup.selectAll('option')
        .data(items)
        .enter()
        .append('option')
        .attr('value', d => d['Entity Name'])
        .text(d => d['Entity Name']);
    }
  }

  populateSelect(select1);
  populateSelect(select2);

  const firstGroup = Array.from(grouped.values())[0];
  if (firstGroup && firstGroup.length > 1) {
    if (!select1.property('value')) select1.property('value', firstGroup[0]['Entity Name']);
    if (!select2.property('value')) select2.property('value', firstGroup[1]['Entity Name']);
  }

  updateSimilarity();
  updateCharts();
}
function renderEntityDetails(entityName, containerId) {
  const entityRow = entities.find(e => e['Entity Name'] === entityName);
  const container = document.getElementById(containerId);
  if (!entityRow || !container) return;

  container.innerHTML += `
    <div class="entity-block">
      <h3 class="entity-name">${entityName}</h3>
      <div class="entity-type">${entityRow['Entity Type'] || ''}</div>
      <p class="entity-description">${entityRow['Brief Description'] || 'No description available.'}</p>
      <p class="entity-source-notes">
        <strong>Notes on Scoring Source:</strong> ${entityRow['ScoreSourceNotes'] || 'N/A'}
      </p>
    </div>
  `;
}
function updateSimilarity() {
  if (!dataLoaded) {
    console.log('Data not yet loaded, skipping similarity update');
    return;
  }

  const entity1 = d3.select('#entity-select1').property('value');
  const entity2 = d3.select('#entity-select2').property('value');
  if (!entity1 || !entity2) {
    d3.select('#similarity-score').text('Similarity Score: N/A');
    return;
  }

  const entId1 = entityToId[entity1];
  const entId2 = entityToId[entity2];

  const raw1 = rawPivotData.find(d => d['EntID'] === entId1);
  const raw2 = rawPivotData.find(d => d['EntID'] === entId2);

  if (raw1 && raw2 && raw1['EntID'] !== raw2['EntID']) {
    const dims1 = Object.keys(raw1).filter(k => k.startsWith('Dim')).map(k => raw1[k]);
    const dims2 = Object.keys(raw2).filter(k => k.startsWith('Dim')).map(k => raw2[k]);

    let numerator = 0, denominator = 0;
    for (let i = 0; i < dims1.length; i++) {
      const absSum = Math.abs(dims1[i]) + Math.abs(dims2[i]);
      if (absSum > 0) {
        numerator += Math.abs(dims1[i] - dims2[i]) / absSum;
        denominator++;
      }
    }

    const similarity = denominator > 0 ? 1 - (numerator / denominator) : null;
    d3.select('#similarity-score').text(
      similarity !== null ? `Similarity Score: ${(similarity * 100).toFixed(0)}%` : 'Similarity Score: N/A'
    );
  } else {
    d3.select('#similarity-score').text('Similarity Score: N/A');
  }
}

function updateCharts() {
  const entity1 = d3.select('#entity-select1').property('value');
  const entity2 = d3.select('#entity-select2').property('value');
  if (!entity1 || !entity2) return;

  const width = 450;
  const height = 400;
  const radialScale = d3.scaleLinear().domain([0, 1]).range([0, 112.5]);
  const centerX = width / 2;
  const centerY = height / 2;

  let svg = d3.select('#chart svg');
  if (!svg.node()) {
    svg = d3.select('#chart').append('svg')
      .attr('width', '100%')
      .attr('height', 'auto')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .style('overflow', 'visible');
  } else {
    svg.selectAll('*').remove();
    svg.attr('viewBox', `0 0 ${width} ${height}`);
  }

  const ticks = [0, 0.25, 0.5, 0.75, 1];
  svg.selectAll('circle')
    .data(ticks)
    .join('circle')
    .attr('cx', centerX)
    .attr('cy', centerY)
    .attr('fill', 'none')
    .attr('stroke', 'gray')
    .attr('r', d => radialScale(d));

  function angleToCoordinate(angle, value) {
    const x = Math.cos(angle) * radialScale(value);
    const y = Math.sin(angle) * radialScale(value);
    return { x: centerX + x, y: centerY - y };
  }

  const data = [rollupData.find(d => d['Entity Name'] === entity1), rollupData.find(d => d['Entity Name'] === entity2)].filter(d => d);
  if (!data.length) return;

  const features = Object.keys(data[0]).filter(k => k !== 'EntID' && k !== 'Entity Name');

  const featureData = features.map((f, i) => {
    const angle = Math.PI / 2 + (2 * Math.PI * i / features.length);
    const labelRadius = radialScale(1) * 1.2 + 5;
    return {
      name: f,
      angle,
      line_coord: angleToCoordinate(angle, 1),
      label_coord: {
        x: centerX + Math.cos(angle) * labelRadius,
        y: centerY - Math.sin(angle) * labelRadius
      }
    };
  });

  svg.selectAll('.axislabel')
    .data(featureData)
    .join('text')
    .attr('class', 'axislabel')
    .attr('x', d => d.label_coord.x)
    .attr('y', d => d.label_coord.y)
    .attr('text-anchor', d => {
      const dx = d.label_coord.x - centerX;
      return dx < -50 ? 'start' : dx > 50 ? 'end' : 'middle';
    })
    .style('font-size', '10px')
    .style('dominant-baseline', 'middle')
    .style('white-space', 'normal')
    .each(function(d) {
      const words = d.name.split(/(?=[A-Z])/);
      d3.select(this).selectAll('tspan').remove();
      d3.select(this).selectAll('tspan')
        .data(words)
        .enter().append('tspan')
        .attr('x', d.label_coord.x)
        .attr('dy', (w, i) => i ? '1.2em' : 0)
        .attr('text-anchor', 'middle')
        .text(w => w);
    });

  const line = d3.line().x(d => d.x).y(d => d.y);
  const colors = ['darkorange', 'green'];

  function getPathCoordinates(d) {
    return features.map((f, i) => {
      const angle = Math.PI / 2 + (2 * Math.PI * i / features.length);
      return angleToCoordinate(angle, d[f]);
    }).concat(angleToCoordinate(Math.PI / 2, d[features[0]]));
  }

  svg.selectAll('path')
    .data(data)
    .join('path')
    .attr('d', d => line(getPathCoordinates(d)))
    .attr('stroke-width', 3)
    .attr('stroke', (_, i) => colors[i])
    .attr('fill', (_, i) => colors[i])
    .attr('fill-opacity', 0.1);

  const labelsDiv = d3.select('#entity-labels');
  labelsDiv.selectAll('*').remove();
  data.forEach((d, i) => {
    labelsDiv.append('span')
      .style('color', colors[i])
      .text(d['Entity Name']);
  });
  const detailDiv = document.getElementById('entity-details');
  if (detailDiv) detailDiv.innerHTML = ''; // Clear previous content
  renderEntityDetails(entity1, 'entity-details');
  renderEntityDetails(entity2, 'entity-details');

// Contrast Bar Chart Rendering
const contrast1 = contrastData.find(d => d['Entity Name'] === entity1);
const contrast2 = contrastData.find(d => d['Entity Name'] === entity2);

if (!contrast1) console.warn(`No contrast data found for ${entity1}`);
if (!contrast2) console.warn(`No contrast data found for ${entity2}`);

if (contrast1 && contrast2) {
  const existingChart = Chart.getChart('bar-chart');
  if (existingChart) existingChart.destroy();

  const labels = Object.keys(contrast1).filter(k => k !== 'EntID' && k !== 'Entity Name');
  const annotations = [];

  labels.forEach(label => {
    const [left, right] = label.split(' to ');
    annotations.push(
      {
        type: 'line',
        yMin: label,
        yMax: label,
        borderColor: 'gray',
        borderWidth: 2
      },
      {
        type: 'label',
        xValue: 0,
        yValue: label,
        content: left || '',
        position: { x: 'start', y: 'center' },
        xAdjust: -150,
        backgroundColor: 'transparent',
        color: 'black',
        font: { size: 12 }
      },
      {
        type: 'label',
        xValue: 1,
        yValue: label,
        content: right || '',
        position: { x: 'end', y: 'center' },
        xAdjust: 150,
        backgroundColor: 'transparent',
        color: 'black',
        font: { size: 12 }
      }
    );
  });

  new Chart(document.getElementById('bar-chart'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: entity1,
          data: labels.map(label => ({ x: contrast1[label] || 0, y: label })),
          backgroundColor: 'darkorange',
          pointRadius: 12,
          showLine: false
        },
        {
          label: entity2,
          data: labels.map(label => ({ x: contrast2[label] || 0, y: label })),
          backgroundColor: 'green',
          pointRadius: 12,
          showLine: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      layout: {
        padding: {
          left: 150,
          right: 150,
          top: 20,
          bottom: 20
        }
      },
      scales: {
        x: {
          min: 0,
          max: 1,
          ticks: {
            stepSize: 0.5
          }
        },
        y: {
          type: 'category',
          labels,
          display: false,
          reverse: true,
          offset: true
        }
      },
      plugins: {
        legend: { position: 'top' },
        annotation: {
          clip: false,
          annotations
        }
      }
    }
  });
}
} // ← Final closing brace for updateCharts now correctly placed here

// Event Listeners for dropdowns
d3.select('#entity-select1').on('change', () => {
  updateCharts();
  updateSimilarity();
});
d3.select('#entity-select2').on('change', () => {
  updateCharts();
  updateSimilarity();
});

// Initial render (if default values are loaded early enough)
updateCharts();
updateSimilarity();
// Fallback in case chart containers are missing
document.addEventListener('DOMContentLoaded', () => {
  if (!document.getElementById('bar-chart')) {
    console.warn('Missing #bar-chart container');
  }
  if (!document.getElementById('chart')) {
    console.warn('Missing #chart container');
  }
  if (!document.getElementById('entity-select1') || !document.getElementById('entity-select2')) {
    console.error('Missing dropdown elements for entity selection');
  }
});

// Optional helper: clean up local cache manually (dev only)
// localStorage.removeItem('Entities');
// localStorage.removeItem('RollUpScores');
// localStorage.removeItem('ContrastScores');
// localStorage.removeItem('RawScorePivot');

// Optional debug trigger
window.forceReloadData = () => {
  localStorage.clear();
  location.reload();
};

// Optional: Show error message box if missing
if (!document.getElementById('error-message')) {
  const errBox = document.createElement('div');
  errBox.id = 'error-message';
  errBox.style.display = 'none';
  errBox.style.color = 'red';
  errBox.style.margin = '10px 0';
  document.body.appendChild(errBox);
}

// Optional: Show spinner if missing
if (!document.getElementById('loading-spinner')) {
  const spinner = document.createElement('div');
  spinner.id = 'loading-spinner';
  spinner.style.display = 'none';
  spinner.textContent = 'Loading...';
  spinner.style.color = 'gray';
  spinner.style.margin = '10px 0';
  document.body.appendChild(spinner);
}
