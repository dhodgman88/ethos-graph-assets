const apiUrl = 'https://script.google.com/macros/s/AKfycbyRS9sMWDZHsX9Y0Oft_NrOghlKzK1lAVgb5L_W1fKYdPDclcyqOFhqWplreWPSRO3LMQ/exec';

let entities = [];
let entityToId = {}; // Map Entity Name to EntID
let rollupData = [];
let contrastData = [];
let rawPivotData = [];
let dataLoaded = false; // Flag to track data readiness

// Fetch entity names and create EntID mapping
console.log('Fetching entities from:', `${apiUrl}?sheet=Entities`);
fetch(`${apiUrl}?sheet=Entities`)
  .then(response => response.json())
  .then(result => {
    console.log('Fetch result for Entities:', result);
    if (result.success) {
      entities = [...new Set(result.rows.map(row => row['Entity Name']?.toString().trim()))].sort();
      entityToId = result.rows.reduce((acc, row) => {
        const idKeys = ['EntID', 'ent_id', 'ID'].find(key => row[key] !== undefined);
        if (idKeys && row['Entity Name'] !== undefined) {
          acc[row['Entity Name'].toString().trim()] = parseInt(row[idKeys].toString().trim());
        }
        return acc;
      }, {});
      console.log('Raw rows from Entities:', result.rows); // Debug raw data
      console.log('Entities fetched:', entities);
      console.log('Entity to ID mapping:', entityToId);
      if (Object.keys(entityToId).length === 0) {
        console.error('No valid EntID to Entity Name mappings found in Entities tab');
      }
      populateDropdowns();
    } else {
      console.error('Error fetching entities:', result.error);
    }
  })
  .catch(error => console.error('Fetch error for Entities:', error))
  .finally(() => {
    if (Object.keys(entityToId).length > 0) {
      dataLoaded = true;
      updateSimilarity(); // Initial similarity update
    }
  });

// Fetch data for all tabs
Promise.all([
  fetch(`${apiUrl}?sheet=RollUpScores`).then(r => r.json()),
  fetch(`${apiUrl}?sheet=ContrastScores`).then(r => r.json()),
  fetch(`${apiUrl}?sheet=RawScorePivot`).then(r => r.json())
]).then(([rollup, contrast, rawPivot]) => {
  console.log('Promise.all result:', { rollup, contrast, rawPivot });
  if (rollup.success) {
    rollupData = rollup.rows;
    console.log('RollUpScores rows:', rollupData);
  } else {
    console.error('Error fetching RollUpScores:', rollup.error);
  }
  if (contrast.success) {
    contrastData = contrast.rows;
    console.log('ContrastScores rows:', contrastData);
  } else {
    console.error('Error fetching ContrastScores:', contrast.error);
  }
  if (rawPivot.success) {
    rawPivotData = rawPivot.rows;
    console.log('RawScorePivot rows:', rawPivotData);
  } else {
    console.error('Error fetching RawScorePivot:', rawPivot.error);
  }
}).catch(error => console.error('Promise.all error:', error))
.finally(() => {
  dataLoaded = true;
  updateSimilarity(); // Update similarity after data load
});

function populateDropdowns() {
  console.log('Populating dropdowns with:', entities);
  const select1 = d3.select('#entity-select1');
  const select2 = d3.select('#entity-select2');
  select1.selectAll('option').data(entities).enter().append('option').attr('value', d => d).text(d => d);
  select2.selectAll('option').data(entities).enter().append('option').attr('value', d => d).text(d => d);
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
  console.log('Mapping entities to EntIDs:', { entity1, entId1, entity2, entId2 });
  if (!entId1 || !entId2) {
    console.error('Invalid EntID mapping:', { entId1, entId2 });
    // Fallback: Try direct lookup in RawScorePivot if Entities mapping fails
    const raw1 = rawPivotData.find(d => d['Entity Name']?.toString().trim() === entity1);
    const raw2 = rawPivotData.find(d => d['Entity Name']?.toString().trim() === entity2);
    if (raw1 && raw2 && raw1['EntID'] !== raw2['EntID']) {
      const dims1 = Object.keys(raw1).filter(key => key.startsWith('Dim')).map(key => raw1[key]);
      const dims2 = Object.keys(raw2).filter(key => key.startsWith('Dim')).map(key => raw2[key]);
      let numerator = 0;
      let denominator = 0;
      for (let i = 0; i < dims1.length; i++) {
        const absC = Math.abs(dims1[i]);
        const absD = Math.abs(dims2[i]);
        const absSum = absC + absD;
        if (absSum > 0) {
          numerator += Math.abs(dims1[i] - dims2[i]) / absSum;
          denominator += 1;
        }
      }
      if (denominator === 0) {
        console.warn('No valid dimension pairs for similarity calculation');
        d3.select('#similarity-score').text('Similarity Score: N/A');
      } else {
        const similarity = 1 - (numerator / denominator);
        d3.select('#similarity-score').text(`Similarity Score: ${similarity.toFixed(2)}`);
        console.log('Similarity calculated (fallback) for', entity1, 'and', entity2, ':', similarity);
      }
    } else {
      console.warn('Fallback failed: RawPivotData missing or duplicate EntIDs:', { raw1, raw2 });
      d3.select('#similarity-score').text('Similarity Score: N/A');
    }
    return;
  }
  const raw1 = rawPivotData.find(d => d['EntID'] === entId1);
  const raw2 = rawPivotData.find(d => d['EntID'] === entId2);
  console.log('Raw data found:', { raw1, raw2 });
  if (raw1 && raw2 && raw1['EntID'] !== raw2['EntID']) {
    const dims1 = Object.keys(raw1).filter(key => key.startsWith('Dim')).map(key => raw1[key]);
    const dims2 = Object.keys(raw2).filter(key => key.startsWith('Dim')).map(key => raw2[key]);
    console.log('Dims1:', dims1);
    console.log('Dims2:', dims2);
    let numerator = 0;
    let denominator = 0;
    for (let i = 0; i < dims1.length; i++) {
      const absC = Math.abs(dims1[i]);
      const absD = Math.abs(dims2[i]);
      const absSum = absC + absD;
      console.log(`Pair ${i}: absC=${absC}, absD=${absD}, absSum=${absSum}, diff=${Math.abs(dims1[i] - dims2[i])}`);
      if (absSum > 0) {
        numerator += Math.abs(dims1[i] - dims2[i]) / absSum;
        denominator += 1;
      }
    }
    console.log('Numerator:', numerator, 'Denominator:', denominator);
    if (denominator === 0) {
      console.warn('No valid dimension pairs for similarity calculation');
      d3.select('#similarity-score').text('Similarity Score: N/A');
    } else {
      const similarity = 1 - (numerator / denominator);
      d3.select('#similarity-score').text(`Similarity Score: ${similarity.toFixed(2)}`);
      console.log('Similarity calculated for', entity1, 'and', entity2, ':', similarity);
    }
  } else {
    console.warn('Invalid or duplicate EntIDs:', entId1, entId2, 'Raw1:', raw1, 'Raw2:', raw2);
    d3.select('#similarity-score').text('Similarity Score: N/A');
  }
}

function updateCharts() {
  updateSimilarity(); // Ensure similarity updates with chart
  const entity1 = d3.select('#entity-select1').property('value');
  const entity2 = d3.select('#entity-select2').property('value');
  const svg = d3.select('#chart svg');
  svg.selectAll('*').remove();
  const legendDiv = d3.select('#legend');
  legendDiv.selectAll('*').remove();

  if (!entity1 || !entity2) {
    return;
  }

  console.log('Updating charts for:', entity1, entity2);

  // Radar Chart (RollUpScores)
  const width = 600;
  const height = 800;
  const radialScale = d3.scaleLinear()
    .domain([0, 1])
    .range([0, 250]);

  const ticks = [0, 0.25, 0.5, 0.75, 1];

  const centerX = width / 2;
  const centerY = height / 2;

  // Draw concentric circles for levels
  svg.selectAll("circle")
    .data(ticks)
    .join("circle")
    .attr("cx", centerX)
    .attr("cy", centerY)
    .attr("fill", "none")
    .attr("stroke", "gray")
    .attr("r", d => radialScale(d));

  // Function to convert angle and value to coordinates
  function angleToCoordinate(angle, value) {
    let mappedValue = Math.max(0, Math.min(1, value));
    const x = Math.cos(angle) * radialScale(mappedValue);
    const y = Math.sin(angle) * radialScale(mappedValue);
    return { "x": centerX + x, "y": centerY - y };
  }

  const data = [rollupData.find(d => d['Entity Name'] === entity1), rollupData.find(d => d['Entity Name'] === entity2)].filter(d => d);
  if (!data.length) {
    console.error('No rollup data for:', entity1, entity2);
    return;
  }

  // Derive features (axes) from the first row's keys, skipping 'EntID' and 'Entity Name'
  const features = Object.keys(data[0]).filter(key => {
    const trimmedKey = key.trim().toLowerCase();
    return trimmedKey !== 'entid' && trimmedKey !== 'entity name';
  });
  console.log('Features (axes):', features); // Debug to confirm exclusion

  const featureData = features.map((f, i) => {
    const angle = (Math.PI / 2) + (2 * Math.PI * i / features.length);
    return {
      "name": f,
      "angle": angle,
      "line_coord": angleToCoordinate(angle, 1),
      "label_coord": angleToCoordinate(angle, 1.05)
    };
  });

  // Draw axis lines
  svg.selectAll("line")
    .data(featureData)
    .join("line")
    .attr("x1", centerX)
    .attr("y1", centerY)
    .attr("x2", d => d.line_coord.x)
    .attr("y2", d => d.line_coord.y)
    .attr("stroke", "black");

  // Draw axis labels
  svg.selectAll(".axislabel")
    .data(featureData)
    .join("text")
    .attr("class", "axislabel")
    .attr("x", d => d.label_coord.x)
    .attr("y", d => d.label_coord.y)
    .attr("text-anchor", "middle")
    .each(function(d) {
      const words = d.name.split(/(?=[A-Z])/);
      d3.select(this).selectAll("tspan")
        .data(words)
        .enter().append("tspan")
        .attr("x", d.label_coord.x)
        .attr("dy", (w, i) => i ? "1.2em" : 0)
        .text(w => w);
    });

  // Line generator for paths
  const line = d3.line()
    .x(d => d.x)
    .y(d => d.y);

  // Expanded colors
  const colors = ["darkorange", "green"];

  // Function to get coordinates for a data point's path
  function getPathCoordinates(data_point) {
    const coordinates = [];
    features.forEach((ft_name, i) => {
      const angle = (Math.PI / 2) + (2 * Math.PI * i / features.length);
      coordinates.push(angleToCoordinate(angle, data_point[ft_name]));
    });
    coordinates.push(coordinates[0]); // Close the path
    return coordinates;
  }

  // Draw all paths, but initially hidden
  svg.selectAll("path")
    .data(data)
    .join("path")
    .attr("class", (_, i) => `series series-${i}`)
    .datum(d => getPathCoordinates(d))
    .attr("d", line)
    .attr("stroke-width", 3)
    .attr("stroke", (_, i) => colors[i % colors.length])
    .attr("fill", (_, i) => colors[i % colors.length])
    .attr("stroke-opacity", 1)
    .attr("fill-opacity", 0.1)
    .style("display", "");

  // Create selectable legend with checkboxes
  legendDiv.append("button")
    .attr("id", "deselect-all")
    .text("Deselect All")
    .on("click", function() {
      d3.selectAll("#legend input[type='checkbox']").property("checked", false);
      d3.selectAll(".series").style("display", "none");
    });

  data.forEach((d, i) => {
    const label = legendDiv.append("label");
    const checkbox = label.append("input")
      .attr("type", "checkbox")
      .attr("id", `entity-${i}`)
      .property("checked", true)
      .on("change", function() {
        d3.selectAll(`.series-${i}`)
          .style("display", this.checked ? "" : "none");
      });
    label.append("span")
      .attr("class", "color-swatch")
      .style("background-color", colors[i % colors.length]);
    label.append("span").text(" " + d['Entity Name']);
  });

  // Bar Chart (ContrastScores - All Axes)
  let barChart = Chart.getChart('bar-chart');
  if (barChart) barChart.destroy();
  const contrast1 = contrastData.find(d => d['Entity Name'] === entity1);
  const contrast2 = contrastData.find(d => d['Entity Name'] === entity2);
  if (contrast1 && contrast2) {
    const labels = Object.keys(contrast1).filter(key => key !== 'EntID' && key !== 'Entity Name');
    const data1 = labels.map(label => contrast1[label] || 0);
    const data2 = labels.map(label => contrast2[label] || 0);
    new Chart(document.getElementById('bar-chart'), {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: entity1,
          data: data1,
          backgroundColor: 'darkorange'
        }, {
          label: entity2,
          data: data2,
          backgroundColor: 'green'
        }]
      },
      options: {
        scales: { y: { beginAtZero: true, max: 1 } },
        plugins: { legend: { position: 'top' } },
        indexAxis: 'x'
      }
    });
  }
}

// Event listeners
d3.select('#entity-select1').on('change', () => { updateCharts(); updateSimilarity(); });
d3.select('#entity-select2').on('change', () => { updateCharts(); updateSimilarity(); });

// Initial update
updateCharts();
updateSimilarity();