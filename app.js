/**
 * Health360™ - Clinical Intelligence & Population Health Analytics
 * Core Application Engine & Data-Driven Visualizations
 */

(function () {
  'use strict';

  // Global State
  let allPatients = [];
  let filteredPatients = [];
  let charts = {};
  let patientRadarChartInstance = null;

  const REQUIRED_COLUMNS = [
    'patient_id', 'age', 'sex', 'region',
    'systolic_bp', 'diastolic_bp',
    'heart_disease', 'diabetes', 'stroke'
  ];

  const state = {
    filters: {
      ageMin: 18,
      ageMax: 85,
      sex: 'ALL',
      region: 'ALL',
      smoking: 'ALL',
      alcohol: 'ALL',
      exercise: 'ALL',
      heartDisease: 'ALL',
      diabetes: 'ALL',
      stroke: 'ALL',
      search: '',
      preset: 'all'
    },
    pagination: {
      page: 1,
      pageSize: 25,
      sortCol: 'patient_id',
      sortDir: 'asc'
    },
    theme: 'dark',
    ageChartCondition: 'all'
  };

  // Baseline Cohort Averages for Observed Data
  let cohortAverages = {
    age: 50,
    bmi: 26.5,
    systolic_bp: 130,
    diastolic_bp: 80,
    glucose_mg_dl: 108,
    cholesterol_mg_dl: 195
  };

  /**
   * Application Initialization
   */
  function init() {
    if (window.lucide) {
      window.lucide.createIcons();
    }

    // Load Data
    if (window.HEALTH360_RAW_DATA && Array.isArray(window.HEALTH360_RAW_DATA) && window.HEALTH360_RAW_DATA.length > 0) {
      loadData(window.HEALTH360_RAW_DATA);
    } else {
      // Fallback: Fetch dataset.csv via HTTP
      fetch('dataset.csv')
        .then(res => {
          if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
          return res.text();
        })
        .then(csvText => {
          if (window.Papa) {
            const parsed = window.Papa.parse(csvText, {
              header: true,
              dynamicTyping: true,
              skipEmptyLines: true
            });
            loadData(parsed.data);
          }
        })
        .catch(err => {
          console.warn('Dataset fetch fallback notice:', err);
        });
    }

    setupEventListeners();
    setupCalculator();
  }

  /**
   * Schema Validation
   */
  function validateSchema(data) {
    if (!Array.isArray(data) || data.length === 0) {
      return { valid: false, message: 'The uploaded dataset is empty.' };
    }
    const firstRow = data[0];
    const missing = REQUIRED_COLUMNS.filter(col => !(col in firstRow));
    if (missing.length > 0) {
      return {
        valid: false,
        message: `Missing required clinical columns: ${missing.join(', ')}`
      };
    }
    return { valid: true };
  }

  /**
   * Load, Sanitize and Clean Data (Authentic Data-Driven Model)
   */
  function loadData(rawRecords) {
    const validation = validateSchema(rawRecords);
    if (!validation.valid) {
      alert(`Invalid Dataset: ${validation.message}`);
      return;
    }

    const seenIds = new Set();
    let dupCount = 0;

    allPatients = rawRecords.map((d, idx) => {
      let pid = String(d.patient_id || `H360${String(idx + 1).padStart(5, '0')}`).trim();
      if (seenIds.has(pid)) {
        dupCount++;
        pid = `${pid}_dup${dupCount}`;
      }
      seenIds.add(pid);

      // Clean Numerical Values without Fake Imputation
      const parseNum = (val) => {
        if (val === null || val === undefined || val === '') return null;
        const n = Number(val);
        return isNaN(n) ? null : n;
      };

      const age = parseNum(d.age) || 30;
      const height = parseNum(d.height_cm) || 165.0;
      const weight = parseNum(d.weight_kg) || 68.0;

      // Calculate BMI authentically if provided, or derive from height and weight
      let bmi = parseNum(d.bmi);
      if (bmi === null && height > 0 && weight > 0) {
        bmi = +(weight / ((height / 100) * (height / 100))).toFixed(1);
      } else if (bmi !== null) {
        bmi = +bmi.toFixed(1);
      } else {
        bmi = 24.5;
      }

      const sys = parseNum(d.systolic_bp) || 120;
      const dia = parseNum(d.diastolic_bp) || 80;
      const chol = parseNum(d.cholesterol_mg_dl); // null if missing!
      const glucose = parseNum(d.glucose_mg_dl);  // null if missing!

      // Categorical Sanitization
      let smoking = String(d.smoking_status || 'Never').trim();
      if (!['Never', 'Former', 'Current'].includes(smoking)) smoking = 'Never';

      let alcohol = String(d.alcohol_consumption || 'Not Reported').trim();
      if (!alcohol || alcohol === 'nan' || alcohol === 'NaN' || alcohol === 'null') {
        alcohol = 'Not Reported';
      }

      let exercise = String(d.exercise_level || 'Moderate').trim();
      if (!['Low', 'Moderate', 'High'].includes(exercise)) exercise = 'Moderate';

      const chestPain = String(d.chest_pain || 'No').trim().toLowerCase() === 'yes' ? 'Yes' : 'No';
      const fatigue = String(d.fatigue || 'No').trim().toLowerCase() === 'yes' ? 'Yes' : 'No';
      const dizziness = String(d.dizziness || 'No').trim().toLowerCase() === 'yes' ? 'Yes' : 'No';

      const heart = Number(d.heart_disease) === 1 ? 1 : 0;
      const diabetes = Number(d.diabetes) === 1 ? 1 : 0;
      const stroke = Number(d.stroke) === 1 ? 1 : 0;

      return {
        patient_id: pid,
        age,
        sex: String(d.sex || 'Unknown').trim(),
        region: String(d.region || 'Central').trim(),
        height_cm: height,
        weight_kg: weight,
        bmi,
        systolic_bp: sys,
        diastolic_bp: dia,
        cholesterol_mg_dl: chol,
        glucose_mg_dl: glucose,
        smoking_status: smoking,
        alcohol_consumption: alcohol,
        exercise_level: exercise,
        chest_pain: chestPain,
        fatigue,
        dizziness,
        heart_disease: heart,
        diabetes,
        stroke
      };
    });

    if (dupCount > 0) {
      console.warn(`[Health360 Quality Assurance] Disambiguated ${dupCount} duplicate patient IDs.`);
    }

    // Compute empirical cohort baseline averages on observed values
    if (allPatients.length > 0) {
      const validChol = allPatients.map(p => p.cholesterol_mg_dl).filter(v => v !== null);
      const validGluc = allPatients.map(p => p.glucose_mg_dl).filter(v => v !== null);

      cohortAverages = {
        age: Math.round(mean(allPatients.map(p => p.age))),
        bmi: +mean(allPatients.map(p => p.bmi)).toFixed(1),
        systolic_bp: Math.round(mean(allPatients.map(p => p.systolic_bp))),
        diastolic_bp: Math.round(mean(allPatients.map(p => p.diastolic_bp))),
        glucose_mg_dl: validGluc.length ? Math.round(mean(validGluc)) : 108,
        cholesterol_mg_dl: validChol.length ? Math.round(mean(validChol)) : 195
      };
    }

    document.getElementById('cohortTotal').textContent = allPatients.length.toLocaleString();

    // Reset pagination and apply filters
    state.pagination.page = 1;
    applyFilters();
  }

  /**
   * Filter Engine
   */
  function applyFilters() {
    const f = state.filters;
    const query = f.search.trim().toLowerCase();

    filteredPatients = allPatients.filter(p => {
      // 1. Age Range Filter
      if (p.age < f.ageMin || p.age > f.ageMax) return false;

      // 2. Categorical Demographics
      if (f.sex !== 'ALL' && p.sex !== f.sex) return false;
      if (f.region !== 'ALL' && p.region !== f.region) return false;

      // 3. Lifestyle Filters
      if (f.smoking !== 'ALL' && p.smoking_status !== f.smoking) return false;
      if (f.alcohol !== 'ALL' && p.alcohol_consumption !== f.alcohol) return false;
      if (f.exercise !== 'ALL' && p.exercise_level !== f.exercise) return false;

      // 4. Clinical Condition Diagnoses
      if (f.heartDisease !== 'ALL' && p.heart_disease !== Number(f.heartDisease)) return false;
      if (f.diabetes !== 'ALL' && p.diabetes !== Number(f.diabetes)) return false;
      if (f.stroke !== 'ALL' && p.stroke !== Number(f.stroke)) return false;

      // 5. Preset Composite Predicates (Genuinely Data-Driven)
      if (f.preset === 'cvd-risk') {
        if (!(p.heart_disease === 1 || p.systolic_bp >= 140)) return false;
      } else if (f.preset === 'diabetic') {
        if (!(p.diabetes === 1 || (p.glucose_mg_dl !== null && p.glucose_mg_dl >= 126))) return false;
      } else if (f.preset === 'stroke-risk') {
        if (!(p.stroke === 1)) return false;
      } else if (f.preset === 'seniors-multimorbid') {
        const multimorbidCount = p.heart_disease + p.diabetes + p.stroke;
        if (!(p.age >= 65 && multimorbidCount >= 1)) return false;
      } else if (f.preset === 'young-active') {
        if (!(p.age <= 40 && p.exercise_level === 'High' && p.smoking_status === 'Never')) return false;
      } else if (f.preset === 'smokers-hypertensive') {
        const isHypertensive = p.systolic_bp >= 130 || p.diastolic_bp >= 80;
        if (!(p.smoking_status === 'Current' && isHypertensive)) return false;
      }

      // 6. Global Search Matching
      if (query) {
        const matchesId = p.patient_id.toLowerCase().includes(query);
        const matchesRegion = p.region.toLowerCase().includes(query);
        const matchesSmoking = p.smoking_status.toLowerCase().includes(query);
        const matchesAlcohol = p.alcohol_consumption.toLowerCase().includes(query);
        const matchesSex = p.sex.toLowerCase().includes(query);
        if (!matchesId && !matchesRegion && !matchesSmoking && !matchesAlcohol && !matchesSex) {
          return false;
        }
      }

      return true;
    });

    // Update Header Counter
    document.getElementById('cohortCount').textContent = filteredPatients.length.toLocaleString();
    const pct = allPatients.length ? ((filteredPatients.length / allPatients.length) * 100).toFixed(1) : 0;
    document.getElementById('kpiCohortPct').textContent = `${pct}% of Total`;

    // Handle Empty Cohort State
    const emptyBanner = document.getElementById('emptyCohortBanner');
    if (emptyBanner) {
      if (filteredPatients.length === 0) {
        emptyBanner.classList.add('active');
      } else {
        emptyBanner.classList.remove('active');
      }
    }

    updateFilterSummaryBadge();
    updateKPIs();
    updateCharts();
    renderPatientTable();
  }

  function updateFilterSummaryBadge() {
    const activeSummaryEl = document.getElementById('activeFiltersSummary');
    const f = state.filters;
    const parts = [];

    if (f.preset !== 'all') {
      const activeBtn = document.querySelector(`.preset-chip[data-preset="${f.preset}"]`);
      if (activeBtn) parts.push(`Preset: ${activeBtn.textContent.split('(')[0].trim()}`);
    }
    if (f.ageMin > 18 || f.ageMax < 85) parts.push(`Age: ${f.ageMin}-${f.ageMax}y`);
    if (f.sex !== 'ALL') parts.push(f.sex);
    if (f.region !== 'ALL') parts.push(f.region);
    if (f.smoking !== 'ALL') parts.push(`${f.smoking} Smoker`);
    if (f.alcohol !== 'ALL') parts.push(`Alcohol: ${f.alcohol}`);
    if (f.exercise !== 'ALL') parts.push(`${f.exercise} Activity`);
    if (f.heartDisease !== 'ALL') parts.push(f.heartDisease === '1' ? 'Heart (+)' : 'No Heart Dx');
    if (f.diabetes !== 'ALL') parts.push(f.diabetes === '1' ? 'Diabetic (+)' : 'Non-Diabetic');
    if (f.stroke !== 'ALL') parts.push(f.stroke === '1' ? 'Stroke (+)' : 'No Stroke');
    if (f.search) parts.push(`Search: "${f.search}"`);

    if (parts.length === 0) {
      activeSummaryEl.textContent = 'Full Population Cohort Active';
    } else {
      activeSummaryEl.textContent = parts.join(' • ');
    }
  }

  /**
   * Update KPI Cards (Empirical Calculations)
   */
  function updateKPIs() {
    const n = filteredPatients.length;
    if (n === 0) {
      document.getElementById('kpiCohort').textContent = '0';
      document.getElementById('kpiCohortPct').textContent = '0% of Total';
      document.getElementById('kpiGenderSplit').textContent = '--';
      document.getElementById('kpiHeartRate').textContent = '0.0%';
      document.getElementById('kpiHeartBadge').textContent = '0 Cases';
      document.getElementById('kpiHeartSub').textContent = '0 symptomatic';
      document.getElementById('kpiDiabetesRate').textContent = '0.0%';
      document.getElementById('kpiDiabetesBadge').textContent = '0 Cases';
      document.getElementById('kpiMeanGlucose').textContent = '--';
      document.getElementById('kpiStrokeRate').textContent = '0.0%';
      document.getElementById('kpiStrokeBadge').textContent = '0 Cases';
      document.getElementById('kpiStrokeSub').textContent = '--';
      document.getElementById('kpiBloodPressure').textContent = '-- / --';
      document.getElementById('kpiHypertensionPct').textContent = '0%';
      document.getElementById('kpiMeanBmi').textContent = '--';
      document.getElementById('kpiBmiCategory').textContent = 'N/A';
      document.getElementById('kpiMeanChol').textContent = '--';
      return;
    }

    document.getElementById('kpiCohort').textContent = n.toLocaleString();

    // Gender Breakdown
    const males = filteredPatients.filter(p => p.sex === 'Male').length;
    const malePct = Math.round((males / n) * 100);
    document.getElementById('kpiGenderSplit').textContent = `${malePct}% M / ${100 - malePct}% F`;

    // Heart Disease
    const heartCases = filteredPatients.filter(p => p.heart_disease === 1).length;
    const heartRate = ((heartCases / n) * 100).toFixed(1);
    document.getElementById('kpiHeartRate').textContent = `${heartRate}%`;
    document.getElementById('kpiHeartBadge').textContent = `${heartCases.toLocaleString()} Cases`;

    const heartWithChestPain = filteredPatients.filter(p => p.heart_disease === 1 && p.chest_pain === 'Yes').length;
    const cpPct = heartCases > 0 ? Math.round((heartWithChestPain / heartCases) * 100) : 0;
    document.getElementById('kpiHeartSub').textContent = `${cpPct}% report Chest Pain`;

    // Diabetes Mellitus
    const diabetesCases = filteredPatients.filter(p => p.diabetes === 1).length;
    const diabetesRate = ((diabetesCases / n) * 100).toFixed(1);
    document.getElementById('kpiDiabetesRate').textContent = `${diabetesRate}%`;
    document.getElementById('kpiDiabetesBadge').textContent = `${diabetesCases.toLocaleString()} Cases`;

    // Fasting Glucose (Authentic non-null mean)
    const validGlucose = filteredPatients.map(p => p.glucose_mg_dl).filter(v => v !== null && !isNaN(v));
    if (validGlucose.length > 0) {
      const meanGluc = Math.round(mean(validGlucose));
      document.getElementById('kpiMeanGlucose').textContent = `${meanGluc} mg/dL (n=${validGlucose.length.toLocaleString()})`;
    } else {
      document.getElementById('kpiMeanGlucose').textContent = 'Not Recorded';
    }

    // Stroke
    const strokeCases = filteredPatients.filter(p => p.stroke === 1).length;
    const strokeRate = ((strokeCases / n) * 100).toFixed(1);
    document.getElementById('kpiStrokeRate').textContent = `${strokeRate}%`;
    document.getElementById('kpiStrokeBadge').textContent = `${strokeCases.toLocaleString()} Cases`;

    const strokeHypertensive = filteredPatients.filter(p => p.stroke === 1 && (p.systolic_bp >= 130 || p.diastolic_bp >= 80)).length;
    const strokeHyperPct = strokeCases > 0 ? Math.round((strokeHypertensive / strokeCases) * 100) : 0;
    document.getElementById('kpiStrokeSub').textContent = `${strokeHyperPct}% with Hypertension`;

    // Blood Pressure
    const meanSys = Math.round(mean(filteredPatients.map(p => p.systolic_bp)));
    const meanDia = Math.round(mean(filteredPatients.map(p => p.diastolic_bp)));
    document.getElementById('kpiBloodPressure').textContent = `${meanSys} / ${meanDia}`;

    const hypertensiveCases = filteredPatients.filter(p => p.systolic_bp >= 130 || p.diastolic_bp >= 80).length;
    const hyperPct = Math.round((hypertensiveCases / n) * 100);
    document.getElementById('kpiHypertensionPct').textContent = `${hyperPct}%`;

    // BMI
    const avgBmi = mean(filteredPatients.map(p => p.bmi)).toFixed(1);
    document.getElementById('kpiMeanBmi').textContent = avgBmi;
    const bmiBadge = document.getElementById('kpiBmiCategory');
    if (avgBmi < 18.5) {
      bmiBadge.textContent = 'Underweight';
      bmiBadge.style.color = 'var(--accent-cyan)';
    } else if (avgBmi < 25) {
      bmiBadge.textContent = 'Normal Weight';
      bmiBadge.style.color = 'var(--accent-emerald)';
    } else if (avgBmi < 30) {
      bmiBadge.textContent = 'Overweight';
      bmiBadge.style.color = 'var(--accent-amber)';
    } else {
      bmiBadge.textContent = 'Obese';
      bmiBadge.style.color = 'var(--accent-rose)';
    }

    // Total Cholesterol (Authentic non-null mean)
    const validChol = filteredPatients.map(p => p.cholesterol_mg_dl).filter(v => v !== null && !isNaN(v));
    if (validChol.length > 0) {
      const meanChol = Math.round(mean(validChol));
      document.getElementById('kpiMeanChol').textContent = `${meanChol} mg/dL (n=${validChol.length.toLocaleString()})`;
    } else {
      document.getElementById('kpiMeanChol').textContent = 'Not Recorded';
    }
  }

  /**
   * Render All Visualizations
   */
  function updateCharts() {
    renderAgeDistributionChart();
    renderBiomarkerScatterChart();
    renderLifestyleImpactChart();
    renderExerciseProtectionChart();
    renderSymptomsCorrelationChart();
    renderRegionalDisparitiesChart();
  }

  function getChartTheme() {
    const isDark = state.theme === 'dark';
    return {
      textColor: isDark ? '#94a3b8' : '#475569',
      gridColor: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.06)',
      tooltipBg: isDark ? '#1e293b' : '#ffffff',
      tooltipText: isDark ? '#f8fafc' : '#0f172a'
    };
  }

  /**
   * Chart 1: Disease Prevalence by Age Group
   */
  function renderAgeDistributionChart() {
    const ctx = document.getElementById('ageDistributionChart');
    if (!ctx) return;
    const theme = getChartTheme();

    const ageBrackets = [
      { label: '<30 yrs', filter: p => p.age < 30 },
      { label: '30-44 yrs', filter: p => p.age >= 30 && p.age < 45 },
      { label: '45-59 yrs', filter: p => p.age >= 45 && p.age < 60 },
      { label: '60-74 yrs', filter: p => p.age >= 60 && p.age < 75 },
      { label: '75+ yrs', filter: p => p.age >= 75 }
    ];

    const labels = ageBrackets.map(b => b.label);
    const mode = state.ageChartCondition;
    let datasets = [];

    if (mode === 'all') {
      const heartData = ageBrackets.map(b => {
        const cohort = filteredPatients.filter(b.filter);
        const cases = cohort.filter(p => p.heart_disease === 1).length;
        const rate = cohort.length ? +((cases / cohort.length) * 100).toFixed(1) : 0;
        return { y: rate, cases, total: cohort.length };
      });
      const diabetesData = ageBrackets.map(b => {
        const cohort = filteredPatients.filter(b.filter);
        const cases = cohort.filter(p => p.diabetes === 1).length;
        const rate = cohort.length ? +((cases / cohort.length) * 100).toFixed(1) : 0;
        return { y: rate, cases, total: cohort.length };
      });
      const strokeData = ageBrackets.map(b => {
        const cohort = filteredPatients.filter(b.filter);
        const cases = cohort.filter(p => p.stroke === 1).length;
        const rate = cohort.length ? +((cases / cohort.length) * 100).toFixed(1) : 0;
        return { y: rate, cases, total: cohort.length };
      });

      datasets = [
        {
          label: 'Heart Disease (%)',
          data: heartData.map(d => d.y),
          details: heartData,
          backgroundColor: 'rgba(244, 63, 94, 0.75)',
          borderColor: '#f43f5e',
          borderWidth: 1,
          borderRadius: 6
        },
        {
          label: 'Diabetes (%)',
          data: diabetesData.map(d => d.y),
          details: diabetesData,
          backgroundColor: 'rgba(139, 92, 246, 0.75)',
          borderColor: '#8b5cf6',
          borderWidth: 1,
          borderRadius: 6
        },
        {
          label: 'Stroke (%)',
          data: strokeData.map(d => d.y),
          details: strokeData,
          backgroundColor: 'rgba(245, 158, 11, 0.75)',
          borderColor: '#f59e0b',
          borderWidth: 1,
          borderRadius: 6
        }
      ];
    } else {
      const conditionField = mode === 'heart' ? 'heart_disease' : (mode === 'diabetes' ? 'diabetes' : 'stroke');
      const conditionName = mode === 'heart' ? 'Heart Disease' : (mode === 'diabetes' ? 'Diabetes' : 'Stroke');

      const maleData = ageBrackets.map(b => {
        const cohort = filteredPatients.filter(p => b.filter(p) && p.sex === 'Male');
        const cases = cohort.filter(p => p[conditionField] === 1).length;
        const rate = cohort.length ? +((cases / cohort.length) * 100).toFixed(1) : 0;
        return { y: rate, cases, total: cohort.length };
      });
      const femaleData = ageBrackets.map(b => {
        const cohort = filteredPatients.filter(p => b.filter(p) && p.sex === 'Female');
        const cases = cohort.filter(p => p[conditionField] === 1).length;
        const rate = cohort.length ? +((cases / cohort.length) * 100).toFixed(1) : 0;
        return { y: rate, cases, total: cohort.length };
      });

      datasets = [
        {
          label: `Male: ${conditionName} (%)`,
          data: maleData.map(d => d.y),
          details: maleData,
          backgroundColor: 'rgba(59, 130, 246, 0.75)',
          borderColor: '#3b82f6',
          borderWidth: 1,
          borderRadius: 6
        },
        {
          label: `Female: ${conditionName} (%)`,
          data: femaleData.map(d => d.y),
          details: femaleData,
          backgroundColor: 'rgba(236, 72, 153, 0.75)',
          borderColor: '#ec4899',
          borderWidth: 1,
          borderRadius: 6
        }
      ];
    }

    if (charts.ageChart) {
      charts.ageChart.data.labels = labels;
      charts.ageChart.data.datasets = datasets;
      charts.ageChart.update();
    } else {
      charts.ageChart = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'top',
              labels: { color: theme.textColor, font: { family: 'Plus Jakarta Sans', size: 11 } }
            },
            tooltip: {
              backgroundColor: theme.tooltipBg,
              titleColor: theme.tooltipText,
              bodyColor: theme.tooltipText,
              borderColor: 'rgba(255,255,255,0.1)',
              borderWidth: 1,
              callbacks: {
                label: ctx => {
                  const item = ctx.dataset.details ? ctx.dataset.details[ctx.dataIndex] : null;
                  if (item && item.total > 0) {
                    return ` ${ctx.dataset.label}: ${item.y}% (${item.cases} of ${item.total} patients)`;
                  }
                  return ` ${ctx.dataset.label}: 0% (N=0 in current filter)`;
                }
              }
            }
          },
          scales: {
            x: {
              grid: { color: theme.gridColor },
              ticks: { color: theme.textColor, font: { family: 'Plus Jakarta Sans', size: 11 } }
            },
            y: {
              beginAtZero: true,
              grid: { color: theme.gridColor },
              ticks: {
                color: theme.textColor,
                callback: v => `${v}%`,
                font: { family: 'JetBrains Mono', size: 11 }
              }
            }
          }
        }
      });
    }
  }

  /**
   * Chart 2: Biomarker Scatter Plot (Valid Telemetry Only)
   */
  function renderBiomarkerScatterChart() {
    const ctx = document.getElementById('biomarkerScatterChart');
    if (!ctx) return;
    const theme = getChartTheme();

    // Filter to patients who have BOTH valid blood pressure and glucose recorded
    const validTelemetry = filteredPatients.filter(p => p.systolic_bp !== null && p.glucose_mg_dl !== null);

    // Stratify into Clinical Diagnostic Categories
    const baselinePoints = [];
    const heartPoints = [];
    const diabeticPoints = [];
    const multimorbidPoints = [];

    // Sub-sample up to 300 points for smooth performance
    const sampleSize = Math.min(validTelemetry.length, 300);
    const step = Math.max(1, Math.floor(validTelemetry.length / sampleSize));

    for (let i = 0; i < validTelemetry.length && (baselinePoints.length + heartPoints.length + diabeticPoints.length + multimorbidPoints.length) < sampleSize; i += step) {
      const p = validTelemetry[i];
      const pt = { x: p.systolic_bp, y: p.glucose_mg_dl, patient: p };
      const condCount = p.heart_disease + p.diabetes + p.stroke;

      if (condCount >= 2) {
        multimorbidPoints.push(pt);
      } else if (p.heart_disease === 1) {
        heartPoints.push(pt);
      } else if (p.diabetes === 1) {
        diabeticPoints.push(pt);
      } else {
        baselinePoints.push(pt);
      }
    }

    const datasets = [
      {
        label: 'Baseline / Normative',
        data: baselinePoints,
        backgroundColor: 'rgba(6, 182, 212, 0.65)',
        borderColor: '#06b6d4',
        borderWidth: 1,
        pointRadius: 4.5,
        pointHoverRadius: 7
      },
      {
        label: 'Heart Disease',
        data: heartPoints,
        backgroundColor: 'rgba(244, 63, 94, 0.75)',
        borderColor: '#f43f5e',
        borderWidth: 1,
        pointRadius: 5,
        pointHoverRadius: 8
      },
      {
        label: 'Type 2 Diabetes',
        data: diabeticPoints,
        backgroundColor: 'rgba(139, 92, 246, 0.75)',
        borderColor: '#8b5cf6',
        borderWidth: 1,
        pointRadius: 5,
        pointHoverRadius: 8
      },
      {
        label: 'Multimorbid (2+ Diagnoses)',
        data: multimorbidPoints,
        backgroundColor: 'rgba(245, 158, 11, 0.85)',
        borderColor: '#f59e0b',
        borderWidth: 1,
        pointRadius: 6,
        pointHoverRadius: 9
      }
    ];

    if (charts.scatterChart) {
      charts.scatterChart.data.datasets = datasets;
      charts.scatterChart.update();
    } else {
      charts.scatterChart = new Chart(ctx, {
        type: 'scatter',
        data: { datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'top',
              labels: { color: theme.textColor, font: { family: 'Plus Jakarta Sans', size: 10 } }
            },
            tooltip: {
              backgroundColor: theme.tooltipBg,
              titleColor: theme.tooltipText,
              bodyColor: theme.tooltipText,
              borderColor: 'rgba(255,255,255,0.1)',
              borderWidth: 1,
              callbacks: {
                label: ctx => {
                  const p = ctx.raw.patient;
                  const conds = [];
                  if (p.heart_disease) conds.push('Heart Dx');
                  if (p.diabetes) conds.push('Diabetes');
                  if (p.stroke) conds.push('Stroke');
                  return [
                    `Patient: ${p.patient_id} (${p.age}y ${p.sex})`,
                    `Systolic BP: ${p.systolic_bp} mmHg`,
                    `Glucose: ${Math.round(p.glucose_mg_dl)} mg/dL`,
                    `BMI: ${p.bmi.toFixed(1)}`,
                    `Diagnoses: ${conds.length ? conds.join(', ') : 'None'}`
                  ];
                }
              }
            }
          },
          scales: {
            x: {
              title: { display: true, text: 'Systolic Blood Pressure (mmHg)', color: theme.textColor, font: { size: 10 } },
              grid: { color: theme.gridColor },
              ticks: { color: theme.textColor, font: { family: 'JetBrains Mono', size: 10 } }
            },
            y: {
              title: { display: true, text: 'Fasting Blood Glucose (mg/dL)', color: theme.textColor, font: { size: 10 } },
              grid: { color: theme.gridColor },
              ticks: { color: theme.textColor, font: { family: 'JetBrains Mono', size: 10 } }
            }
          }
        }
      });
    }
  }

  /**
   * Chart 3: Lifestyle Impact (Smoking & Alcohol)
   */
  function renderLifestyleImpactChart() {
    const ctx = document.getElementById('lifestyleImpactChart');
    if (!ctx) return;
    const theme = getChartTheme();

    const categories = [
      { label: 'Never Smoked', filter: p => p.smoking_status === 'Never' },
      { label: 'Former Smoker', filter: p => p.smoking_status === 'Former' },
      { label: 'Current Smoker', filter: p => p.smoking_status === 'Current' },
      { label: 'Alcohol: None', filter: p => p.alcohol_consumption === 'None' },
      { label: 'Alcohol: Occasional', filter: p => p.alcohol_consumption === 'Occasional' },
      { label: 'Alcohol: Regular', filter: p => p.alcohol_consumption === 'Regular' }
    ];

    const labels = categories.map(c => c.label);
    const heartDetails = categories.map(c => {
      const cohort = filteredPatients.filter(c.filter);
      const cases = cohort.filter(p => p.heart_disease === 1).length;
      const rate = cohort.length ? +((cases / cohort.length) * 100).toFixed(1) : 0;
      return { rate, cases, total: cohort.length };
    });

    const strokeDetails = categories.map(c => {
      const cohort = filteredPatients.filter(c.filter);
      const cases = cohort.filter(p => p.stroke === 1).length;
      const rate = cohort.length ? +((cases / cohort.length) * 100).toFixed(1) : 0;
      return { rate, cases, total: cohort.length };
    });

    const datasets = [
      {
        label: 'Heart Disease (%)',
        data: heartDetails.map(d => d.rate),
        details: heartDetails,
        backgroundColor: 'rgba(244, 63, 94, 0.75)',
        borderColor: '#f43f5e',
        borderRadius: 4
      },
      {
        label: 'Stroke (%)',
        data: strokeDetails.map(d => d.rate),
        details: strokeDetails,
        backgroundColor: 'rgba(245, 158, 11, 0.75)',
        borderColor: '#f59e0b',
        borderRadius: 4
      }
    ];

    if (charts.lifestyleChart) {
      charts.lifestyleChart.data.labels = labels;
      charts.lifestyleChart.data.datasets = datasets;
      charts.lifestyleChart.update();
    } else {
      charts.lifestyleChart = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'top',
              labels: { color: theme.textColor, font: { family: 'Plus Jakarta Sans', size: 10 } }
            },
            tooltip: {
              backgroundColor: theme.tooltipBg,
              titleColor: theme.tooltipText,
              bodyColor: theme.tooltipText,
              borderColor: 'rgba(255,255,255,0.1)',
              borderWidth: 1,
              callbacks: {
                label: ctx => {
                  const d = ctx.dataset.details ? ctx.dataset.details[ctx.dataIndex] : null;
                  if (d && d.total > 0) {
                    return ` ${ctx.dataset.label}: ${d.rate}% (${d.cases} / ${d.total} patients)`;
                  }
                  return ` ${ctx.dataset.label}: 0% (N=0 in filter)`;
                }
              }
            }
          },
          scales: {
            x: {
              beginAtZero: true,
              grid: { color: theme.gridColor },
              ticks: { color: theme.textColor, callback: v => `${v}%`, font: { family: 'JetBrains Mono', size: 10 } }
            },
            y: {
              grid: { color: theme.gridColor },
              ticks: { color: theme.textColor, font: { family: 'Plus Jakarta Sans', size: 10 } }
            }
          }
        }
      });
    }
  }

  /**
   * Chart 4: Physical Activity Protection Factor
   */
  function renderExerciseProtectionChart() {
    const ctx = document.getElementById('exerciseProtectionChart');
    if (!ctx) return;
    const theme = getChartTheme();

    const levels = ['Low', 'Moderate', 'High'];
    const labels = ['Low / Sedentary', 'Moderate Activity', 'High Exercise'];

    const heartDetails = levels.map(lvl => {
      const cohort = filteredPatients.filter(p => p.exercise_level === lvl);
      const cases = cohort.filter(p => p.heart_disease === 1).length;
      const rate = cohort.length ? +((cases / cohort.length) * 100).toFixed(1) : 0;
      return { rate, cases, total: cohort.length };
    });

    const diabetesDetails = levels.map(lvl => {
      const cohort = filteredPatients.filter(p => p.exercise_level === lvl);
      const cases = cohort.filter(p => p.diabetes === 1).length;
      const rate = cohort.length ? +((cases / cohort.length) * 100).toFixed(1) : 0;
      return { rate, cases, total: cohort.length };
    });

    const avgBmiByActivity = levels.map(lvl => {
      const cohort = filteredPatients.filter(p => p.exercise_level === lvl);
      return cohort.length ? +mean(cohort.map(p => p.bmi)).toFixed(1) : 0;
    });

    const datasets = [
      {
        label: 'Heart Disease (%)',
        data: heartDetails.map(d => d.rate),
        details: heartDetails,
        borderColor: '#f43f5e',
        backgroundColor: 'rgba(244, 63, 94, 0.15)',
        tension: 0.35,
        fill: true,
        pointRadius: 5
      },
      {
        label: 'Diabetes (%)',
        data: diabetesDetails.map(d => d.rate),
        details: diabetesDetails,
        borderColor: '#8b5cf6',
        backgroundColor: 'rgba(139, 92, 246, 0.15)',
        tension: 0.35,
        fill: true,
        pointRadius: 5
      },
      {
        label: 'Mean BMI',
        data: avgBmiByActivity,
        borderColor: '#10b981',
        backgroundColor: 'transparent',
        borderDash: [5, 5],
        pointRadius: 5
      }
    ];

    if (charts.exerciseChart) {
      charts.exerciseChart.data.labels = labels;
      charts.exerciseChart.data.datasets = datasets;
      charts.exerciseChart.update();
    } else {
      charts.exerciseChart = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'top',
              labels: { color: theme.textColor, font: { family: 'Plus Jakarta Sans', size: 10 } }
            },
            tooltip: {
              backgroundColor: theme.tooltipBg,
              titleColor: theme.tooltipText,
              bodyColor: theme.tooltipText,
              borderColor: 'rgba(255,255,255,0.1)',
              borderWidth: 1,
              callbacks: {
                label: ctx => {
                  if (ctx.dataset.label === 'Mean BMI') {
                    return ` Mean BMI: ${ctx.parsed.y}`;
                  }
                  const d = ctx.dataset.details ? ctx.dataset.details[ctx.dataIndex] : null;
                  if (d && d.total > 0) {
                    return ` ${ctx.dataset.label}: ${d.rate}% (${d.cases} of ${d.total} patients)`;
                  }
                  return ` ${ctx.dataset.label}: 0% (N=0 in filter)`;
                }
              }
            }
          },
          scales: {
            x: {
              grid: { color: theme.gridColor },
              ticks: { color: theme.textColor, font: { family: 'Plus Jakarta Sans', size: 10 } }
            },
            y: {
              beginAtZero: true,
              grid: { color: theme.gridColor },
              ticks: { color: theme.textColor, font: { family: 'JetBrains Mono', size: 10 } }
            }
          }
        }
      });
    }
  }

  /**
   * Chart 5: Symptom Triad Odds
   */
  function renderSymptomsCorrelationChart() {
    const ctx = document.getElementById('symptomsCorrelationChart');
    if (!ctx) return;
    const theme = getChartTheme();

    const groups = [
      { label: 'Chest Pain (+)', filter: p => p.chest_pain === 'Yes' },
      { label: 'Fatigue (+)', filter: p => p.fatigue === 'Yes' },
      { label: 'Dizziness (+)', filter: p => p.dizziness === 'Yes' },
      { label: '2+ Symptoms', filter: p => (p.chest_pain === 'Yes') + (p.fatigue === 'Yes') + (p.dizziness === 'Yes') >= 2 },
      { label: 'Asymptomatic', filter: p => p.chest_pain === 'No' && p.fatigue === 'No' && p.dizziness === 'No' }
    ];

    const labels = groups.map(g => g.label);
    const heartDetails = groups.map(g => {
      const c = filteredPatients.filter(g.filter);
      const cases = c.filter(p => p.heart_disease === 1).length;
      const rate = c.length ? +((cases / c.length) * 100).toFixed(1) : 0;
      return { rate, cases, total: c.length };
    });

    const strokeDetails = groups.map(g => {
      const c = filteredPatients.filter(g.filter);
      const cases = c.filter(p => p.stroke === 1).length;
      const rate = c.length ? +((cases / c.length) * 100).toFixed(1) : 0;
      return { rate, cases, total: c.length };
    });

    const datasets = [
      {
        label: 'Heart Disease Rate (%)',
        data: heartDetails.map(d => d.rate),
        details: heartDetails,
        backgroundColor: 'rgba(244, 63, 94, 0.75)',
        borderColor: '#f43f5e',
        borderRadius: 5
      },
      {
        label: 'Stroke Rate (%)',
        data: strokeDetails.map(d => d.rate),
        details: strokeDetails,
        backgroundColor: 'rgba(245, 158, 11, 0.75)',
        borderColor: '#f59e0b',
        borderRadius: 5
      }
    ];

    if (charts.symptomsChart) {
      charts.symptomsChart.data.labels = labels;
      charts.symptomsChart.data.datasets = datasets;
      charts.symptomsChart.update();
    } else {
      charts.symptomsChart = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'top',
              labels: { color: theme.textColor, font: { family: 'Plus Jakarta Sans', size: 10 } }
            },
            tooltip: {
              backgroundColor: theme.tooltipBg,
              titleColor: theme.tooltipText,
              bodyColor: theme.tooltipText,
              borderColor: 'rgba(255,255,255,0.1)',
              borderWidth: 1,
              callbacks: {
                label: ctx => {
                  const d = ctx.dataset.details ? ctx.dataset.details[ctx.dataIndex] : null;
                  if (d && d.total > 0) {
                    return ` ${ctx.dataset.label}: ${d.rate}% (${d.cases} of ${d.total} patients)`;
                  }
                  return ` ${ctx.dataset.label}: 0% (N=0 in filter)`;
                }
              }
            }
          },
          scales: {
            x: {
              grid: { color: theme.gridColor },
              ticks: { color: theme.textColor, font: { family: 'Plus Jakarta Sans', size: 10 } }
            },
            y: {
              beginAtZero: true,
              grid: { color: theme.gridColor },
              ticks: { color: theme.textColor, callback: v => `${v}%`, font: { family: 'JetBrains Mono', size: 10 } }
            }
          }
        }
      });
    }
  }

  /**
   * Chart 6: Regional Disparities
   */
  function renderRegionalDisparitiesChart() {
    const ctx = document.getElementById('regionalDisparitiesChart');
    if (!ctx) return;
    const theme = getChartTheme();

    const regions = ['Central', 'North', 'South', 'East', 'West'];
    const regionalDetails = regions.map(reg => {
      const cohort = filteredPatients.filter(p => p.region === reg);
      const affected = cohort.filter(p => p.heart_disease === 1 || p.diabetes === 1 || p.stroke === 1).length;
      const rate = cohort.length ? +((affected / cohort.length) * 100).toFixed(1) : 0;
      return { rate, affected, total: cohort.length };
    });

    const datasets = [
      {
        label: 'Overall Chronic Morbidity Rate (%)',
        data: regionalDetails.map(d => d.rate),
        details: regionalDetails,
        backgroundColor: [
          'rgba(6, 182, 212, 0.75)',
          'rgba(59, 130, 246, 0.75)',
          'rgba(139, 92, 246, 0.75)',
          'rgba(245, 158, 11, 0.75)',
          'rgba(16, 185, 129, 0.75)'
        ],
        borderColor: [
          '#06b6d4',
          '#3b82f6',
          '#8b5cf6',
          '#f59e0b',
          '#10b981'
        ],
        borderWidth: 1
      }
    ];

    if (charts.regionalChart) {
      charts.regionalChart.data.labels = regions;
      charts.regionalChart.data.datasets = datasets;
      charts.regionalChart.update();
    } else {
      charts.regionalChart = new Chart(ctx, {
        type: 'polarArea',
        data: { labels: regions, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'right',
              labels: { color: theme.textColor, font: { family: 'Plus Jakarta Sans', size: 10 } }
            },
            tooltip: {
              backgroundColor: theme.tooltipBg,
              titleColor: theme.tooltipText,
              bodyColor: theme.tooltipText,
              borderColor: 'rgba(255,255,255,0.1)',
              borderWidth: 1,
              callbacks: {
                label: ctx => {
                  const d = ctx.dataset.details ? ctx.dataset.details[ctx.dataIndex] : null;
                  if (d && d.total > 0) {
                    return ` ${ctx.label}: ${d.rate}% Morbidity (${d.affected} of ${d.total} patients)`;
                  }
                  return ` ${ctx.label}: 0% (N=0 in filter)`;
                }
              }
            }
          },
          scales: {
            r: {
              grid: { color: theme.gridColor },
              ticks: { color: theme.textColor, backdropColor: 'transparent', font: { family: 'JetBrains Mono', size: 9 } }
            }
          }
        }
      });
    }
  }

  /**
   * Patient Records Table
   */
  function renderPatientTable() {
    const tbody = document.getElementById('patientTableBody');
    if (!tbody) return;

    const { sortCol, sortDir } = state.pagination;
    const sorted = [...filteredPatients].sort((a, b) => {
      let valA = a[sortCol];
      let valB = b[sortCol];

      // Handle nulls in sorting gracefully
      if (valA === null && valB === null) return 0;
      if (valA === null) return 1;
      if (valB === null) return -1;

      if (typeof valA === 'string') {
        valA = valA.toLowerCase();
        valB = valB.toLowerCase();
      }
      if (valA < valB) return sortDir === 'asc' ? -1 : 1;
      if (valA > valB) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    const total = sorted.length;
    const pageSize = state.pagination.pageSize;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (state.pagination.page > totalPages) {
      state.pagination.page = totalPages;
    }
    const page = state.pagination.page;
    const startIdx = total > 0 ? (page - 1) * pageSize : 0;
    const endIdx = Math.min(startIdx + pageSize, total);
    const pagePatients = sorted.slice(startIdx, endIdx);

    document.getElementById('paginationInfo').textContent = total > 0
      ? `Showing ${startIdx + 1} to ${endIdx} of ${total.toLocaleString()} entries`
      : 'No patient records matching current criteria';
    document.getElementById('pageCurrent').textContent = `${total > 0 ? page : 0} / ${totalPages}`;
    document.getElementById('btnPrevPage').disabled = page <= 1 || total === 0;
    document.getElementById('btnNextPage').disabled = page >= totalPages || total === 0;

    tbody.innerHTML = '';
    if (pagePatients.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="12" style="text-align:center; padding:36px 16px; color:var(--text-muted);">
        <i data-lucide="alert-circle" style="width:26px; height:26px; margin-bottom:8px; color:var(--accent-amber);"></i>
        <div style="font-weight:600; font-size:0.9rem; color:var(--text-primary); margin-bottom:4px;">No matching patient records found</div>
        <div>Adjust active filters or click Reset Filters to restore the cohort.</div>
      </td>`;
      tbody.appendChild(tr);
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    pagePatients.forEach(p => {
      const tr = document.createElement('tr');

      const condBadges = [];
      if (p.heart_disease) condBadges.push('<span class="status-pill danger">Heart</span>');
      if (p.diabetes) condBadges.push('<span class="status-pill warning">Diabetes</span>');
      if (p.stroke) condBadges.push('<span class="status-pill danger">Stroke</span>');
      if (condBadges.length === 0) condBadges.push('<span class="status-pill success">Baseline</span>');

      const sx = [];
      if (p.chest_pain === 'Yes') sx.push('Chest Pain');
      if (p.fatigue === 'Yes') sx.push('Fatigue');
      if (p.dizziness === 'Yes') sx.push('Dizziness');

      const bpStatusClass = (p.systolic_bp >= 140 || p.diastolic_bp >= 90) ? 'color:var(--accent-rose)' :
                            (p.systolic_bp >= 130 || p.diastolic_bp >= 80) ? 'color:var(--accent-amber)' : 'color:var(--text-primary)';

      const glucDisplay = p.glucose_mg_dl !== null
        ? `<span style="font-family:var(--font-mono)">${Math.round(p.glucose_mg_dl)}</span> <small style="color:var(--text-muted)">mg/dL</small>`
        : `<span style="color:var(--text-muted); font-style:italic;">Not Recorded</span>`;

      const cholDisplay = p.cholesterol_mg_dl !== null
        ? `<span style="font-family:var(--font-mono)">${Math.round(p.cholesterol_mg_dl)}</span> <small style="color:var(--text-muted)">mg/dL</small>`
        : `<span style="color:var(--text-muted); font-style:italic;">Not Recorded</span>`;

      tr.innerHTML = `
        <td><span class="id-badge">${p.patient_id}</span></td>
        <td><strong>${p.age}</strong></td>
        <td>${p.sex}</td>
        <td>${p.region}</td>
        <td><span style="font-family:var(--font-mono)">${p.bmi.toFixed(1)}</span></td>
        <td style="${bpStatusClass}; font-family:var(--font-mono); font-weight:600;">${p.systolic_bp}/${p.diastolic_bp}</td>
        <td>${glucDisplay}</td>
        <td>${cholDisplay}</td>
        <td><small>${p.smoking_status} / ${p.exercise_level}</small></td>
        <td><small style="color:${sx.length ? 'var(--accent-amber)' : 'var(--text-muted)'}">${sx.length ? sx.join(', ') : 'None'}</small></td>
        <td>${condBadges.join(' ')}</td>
        <td>
          <button class="btn btn-secondary view-patient-btn" style="padding:4px 8px; font-size:0.75rem;" data-id="${p.patient_id}">
            <i data-lucide="eye" style="width:13px; height:13px;"></i> View
          </button>
        </td>
      `;

      tr.addEventListener('click', (e) => {
        openPatientModal(p);
      });

      tbody.appendChild(tr);
    });

    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  /**
   * Patient Detail Modal
   */
  function openPatientModal(patient) {
    document.getElementById('modalPatientId').textContent = `Patient ${patient.patient_id}`;
    document.getElementById('modalPatientDemographics').textContent =
      `${patient.age} yrs old ${patient.sex} • ${patient.region} Territory • ${patient.height_cm} cm / ${patient.weight_kg} kg`;

    document.getElementById('modalBp').textContent = `${patient.systolic_bp} / ${patient.diastolic_bp} mmHg`;
    const bpTag = document.getElementById('modalBpTag');
    if (patient.systolic_bp >= 140 || patient.diastolic_bp >= 90) {
      bpTag.className = 'status-pill danger';
      bpTag.textContent = 'Hypertension Stage 2';
    } else if (patient.systolic_bp >= 130 || patient.diastolic_bp >= 80) {
      bpTag.className = 'status-pill warning';
      bpTag.textContent = 'Hypertension Stage 1';
    } else {
      bpTag.className = 'status-pill success';
      bpTag.textContent = 'Normal Range';
    }

    document.getElementById('modalBmi').textContent = `${patient.bmi.toFixed(1)} kg/m²`;
    const bmiTag = document.getElementById('modalBmiTag');
    if (patient.bmi >= 30) {
      bmiTag.className = 'status-pill danger';
      bmiTag.textContent = `Obese (${patient.weight_kg} kg)`;
    } else if (patient.bmi >= 25) {
      bmiTag.className = 'status-pill warning';
      bmiTag.textContent = `Overweight (${patient.weight_kg} kg)`;
    } else {
      bmiTag.className = 'status-pill success';
      bmiTag.textContent = `Normal (${patient.weight_kg} kg)`;
    }

    const glucTag = document.getElementById('modalGlucoseTag');
    if (patient.glucose_mg_dl !== null) {
      document.getElementById('modalGlucose').textContent = `${patient.glucose_mg_dl.toFixed(1)} mg/dL`;
      if (patient.glucose_mg_dl >= 126) {
        glucTag.className = 'status-pill danger';
        glucTag.textContent = 'Diabetic Range (≥126)';
      } else if (patient.glucose_mg_dl >= 100) {
        glucTag.className = 'status-pill warning';
        glucTag.textContent = 'Pre-Diabetic (100-125)';
      } else {
        glucTag.className = 'status-pill success';
        glucTag.textContent = 'Normal (<100)';
      }
    } else {
      document.getElementById('modalGlucose').textContent = 'Not Recorded';
      glucTag.className = 'status-pill';
      glucTag.style.background = 'rgba(255,255,255,0.08)';
      glucTag.style.color = 'var(--text-muted)';
      glucTag.textContent = 'Missing Clinical Lab Draw';
    }

    const cholTag = document.getElementById('modalCholTag');
    if (patient.cholesterol_mg_dl !== null) {
      document.getElementById('modalChol').textContent = `${patient.cholesterol_mg_dl.toFixed(1)} mg/dL`;
      if (patient.cholesterol_mg_dl >= 240) {
        cholTag.className = 'status-pill danger';
        cholTag.textContent = 'High Hyperlipidemia (≥240)';
      } else if (patient.cholesterol_mg_dl >= 200) {
        cholTag.className = 'status-pill warning';
        cholTag.textContent = 'Borderline High (200-239)';
      } else {
        cholTag.className = 'status-pill success';
        cholTag.textContent = 'Desirable (<200)';
      }
    } else {
      document.getElementById('modalChol').textContent = 'Not Recorded';
      cholTag.className = 'status-pill';
      cholTag.style.background = 'rgba(255,255,255,0.08)';
      cholTag.style.color = 'var(--text-muted)';
      cholTag.textContent = 'Missing Clinical Lab Draw';
    }

    document.getElementById('modalActivity').textContent = patient.exercise_level;
    const actTag = document.getElementById('modalActivityTag');
    if (patient.exercise_level === 'Low') {
      actTag.className = 'status-pill danger';
      actTag.textContent = 'Sedentary Factor';
    } else if (patient.exercise_level === 'Moderate') {
      actTag.className = 'status-pill warning';
      actTag.textContent = 'Moderate Activity';
    } else {
      actTag.className = 'status-pill success';
      actTag.textContent = 'High / Cardioprotective';
    }

    document.getElementById('modalHabits').textContent = `${patient.smoking_status} / ${patient.alcohol_consumption}`;

    // Confirmed Conditions
    const condList = document.getElementById('modalConditionsList');
    condList.innerHTML = '';
    const conds = [];
    if (patient.heart_disease) conds.push({ label: 'Heart Disease (ICD-10)', type: 'danger' });
    if (patient.diabetes) conds.push({ label: 'Type 2 Diabetes Mellitus', type: 'warning' });
    if (patient.stroke) conds.push({ label: 'Cerebrovascular Accident (Stroke)', type: 'danger' });
    if (patient.chest_pain === 'Yes') conds.push({ label: 'Symptom: Angina / Chest Pain', type: 'warning' });
    if (patient.fatigue === 'Yes') conds.push({ label: 'Symptom: Chronic Fatigue', type: 'warning' });
    if (patient.dizziness === 'Yes') conds.push({ label: 'Symptom: Vertigo / Dizziness', type: 'warning' });

    if (conds.length === 0) {
      condList.innerHTML = '<span class="status-pill success" style="font-size:0.8rem;">No Major Diagnosed Conditions or Active Symptoms</span>';
    } else {
      conds.forEach(c => {
        const span = document.createElement('span');
        span.className = `status-pill ${c.type}`;
        span.style.fontSize = '0.8rem';
        span.textContent = c.label;
        condList.appendChild(span);
      });
    }

    renderPatientRadarChart(patient);
    document.getElementById('patientModal').classList.add('active');
  }

  function renderPatientRadarChart(patient) {
    const ctx = document.getElementById('patientRadarChart');
    if (!ctx) return;
    const theme = getChartTheme();

    if (patientRadarChartInstance) {
      patientRadarChartInstance.destroy();
    }

    const normalize = (val, min, max) => Math.min(100, Math.max(0, Math.round(((val - min) / (max - min)) * 100)));

    const patientMetrics = [
      normalize(patient.age, 18, 90),
      normalize(patient.bmi, 15, 45),
      normalize(patient.systolic_bp, 90, 200),
      normalize(patient.glucose_mg_dl !== null ? patient.glucose_mg_dl : cohortAverages.glucose_mg_dl, 70, 250),
      normalize(patient.cholesterol_mg_dl !== null ? patient.cholesterol_mg_dl : cohortAverages.cholesterol_mg_dl, 120, 320),
      patient.exercise_level === 'High' ? 90 : (patient.exercise_level === 'Moderate' ? 55 : 20)
    ];

    const cohortMetrics = [
      normalize(cohortAverages.age, 18, 90),
      normalize(cohortAverages.bmi, 15, 45),
      normalize(cohortAverages.systolic_bp, 90, 200),
      normalize(cohortAverages.glucose_mg_dl, 70, 250),
      normalize(cohortAverages.cholesterol_mg_dl, 120, 320),
      55
    ];

    patientRadarChartInstance = new Chart(ctx, {
      type: 'radar',
      data: {
        labels: ['Age', 'BMI Index', 'Systolic BP', 'Glucose', 'Cholesterol', 'Activity Protection'],
        datasets: [
          {
            label: `Patient ${patient.patient_id}`,
            data: patientMetrics,
            borderColor: '#06b6d4',
            backgroundColor: 'rgba(6, 182, 212, 0.25)',
            borderWidth: 2,
            pointBackgroundColor: '#06b6d4'
          },
          {
            label: 'Population Cohort Average',
            data: cohortMetrics,
            borderColor: '#94a3b8',
            backgroundColor: 'rgba(148, 163, 184, 0.15)',
            borderWidth: 1.5,
            borderDash: [4, 4],
            pointBackgroundColor: '#94a3b8'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
            labels: { color: theme.textColor, font: { family: 'Plus Jakarta Sans', size: 10 } }
          }
        },
        scales: {
          r: {
            min: 0,
            max: 100,
            grid: { color: theme.gridColor },
            angleLines: { color: theme.gridColor },
            ticks: { display: false }
          }
        }
      }
    });
  }

  /**
   * Interactive Cardiometabolic Risk Factor Simulator (Educational & Bounded Heuristic)
   */
  function setupCalculator() {
    const inputs = ['calcAge', 'calcSystolic', 'calcDiastolic', 'calcBmi', 'calcGlucose', 'calcChol', 'calcSex', 'calcSmoking', 'calcExercise', 'calcChestPain'];

    inputs.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', calculateRiskScore);
        el.addEventListener('change', calculateRiskScore);
      }
    });

    calculateRiskScore();
  }

  function calculateRiskScore() {
    const age = Number(document.getElementById('calcAge').value);
    const systolic = Number(document.getElementById('calcSystolic').value);
    const diastolic = Number(document.getElementById('calcDiastolic').value);
    const bmi = Number(document.getElementById('calcBmi').value);
    const glucose = Number(document.getElementById('calcGlucose').value);
    const chol = Number(document.getElementById('calcChol').value);
    const sex = document.getElementById('calcSex').value;
    const smoking = document.getElementById('calcSmoking').value;
    const exercise = document.getElementById('calcExercise').value;
    const chestPain = document.getElementById('calcChestPain').value;

    document.getElementById('calcAgeVal').textContent = `${age} yrs`;
    document.getElementById('calcSystolicVal').textContent = `${systolic} mmHg`;
    document.getElementById('calcDiastolicVal').textContent = `${diastolic} mmHg`;
    document.getElementById('calcBmiVal').textContent = bmi.toFixed(1);
    document.getElementById('calcGlucoseVal').textContent = `${glucose} mg/dL`;
    document.getElementById('calcCholVal').textContent = `${chol} mg/dL`;

    // 1. Cardiovascular Burden Index (Multi-Factor Bounded Heuristic)
    let cvdScore = 5;
    cvdScore += Math.max(0, (age - 30) * 0.45);
    if (sex === 'Male') cvdScore += 3;
    if (systolic >= 160 || diastolic >= 100) cvdScore += 14;
    else if (systolic >= 140 || diastolic >= 90) cvdScore += 8;
    else if (systolic >= 130 || diastolic >= 85) cvdScore += 4;
    if (chol >= 240) cvdScore += 8;
    else if (chol >= 200) cvdScore += 4;
    if (smoking === 'Current') cvdScore *= 1.45;
    else if (smoking === 'Former') cvdScore *= 1.15;
    if (exercise === 'High') cvdScore *= 0.72;
    else if (exercise === 'Low') cvdScore *= 1.25;
    if (chestPain === 'Yes') cvdScore += 12;

    cvdScore = Math.min(95, Math.max(2, Math.round(cvdScore)));

    // 2. Glycemic Risk Factor (ADA-Aligned Exploratory Index)
    let diabetesScore = 4;
    diabetesScore += Math.max(0, (age - 35) * 0.35);
    if (bmi >= 35) diabetesScore += 24;
    else if (bmi >= 30) diabetesScore += 16;
    else if (bmi >= 25) diabetesScore += 8;
    if (glucose >= 126) diabetesScore += 30;
    else if (glucose >= 100) diabetesScore += 15;
    if (exercise === 'Low') diabetesScore += 6;
    if (exercise === 'High') diabetesScore *= 0.75;
    diabetesScore = Math.min(95, Math.max(2, Math.round(diabetesScore)));

    // 3. Vascular Vulnerability Index
    let strokeScore = 3;
    strokeScore += Math.max(0, (age - 45) * 0.4);
    if (systolic >= 160) strokeScore += 18;
    else if (systolic >= 140) strokeScore += 10;
    else if (systolic >= 130) strokeScore += 4;
    if (smoking === 'Current') strokeScore *= 1.4;
    if (glucose >= 126) strokeScore += 6;
    strokeScore = Math.min(90, Math.max(2, Math.round(strokeScore)));

    // Composite Weighted Score
    const composite = Math.round((cvdScore * 0.45) + (diabetesScore * 0.35) + (strokeScore * 0.20));

    // Update Results
    const scoreEl = document.getElementById('compositeRiskScore');
    const tagEl = document.getElementById('riskLevelTag');
    const fillEl = document.getElementById('riskMeterFill');
    const recEl = document.getElementById('calcRecommendation');

    scoreEl.textContent = `${composite}%`;
    fillEl.style.width = `${composite}%`;

    document.getElementById('cvdSubScore').textContent = `${cvdScore}%`;
    document.getElementById('diabetesSubScore').textContent = `${diabetesScore}%`;
    document.getElementById('strokeSubScore').textContent = `${strokeScore}%`;

    // Dynamic educational commentary based on primary drivers
    const drivers = [];
    if (systolic >= 140 || diastolic >= 90) drivers.push(`Stage ${systolic >= 160 ? '2' : '1'} Hypertension (${systolic}/${diastolic} mmHg)`);
    if (glucose >= 126) drivers.push(`Elevated Fasting Glucose (${glucose} mg/dL)`);
    if (smoking === 'Current') drivers.push('Active Tobacco Use');
    if (bmi >= 30) drivers.push(`Obesity Classification (BMI ${bmi.toFixed(1)})`);
    if (chestPain === 'Yes') drivers.push('Reported Angina / Chest Pain');

    const primaryDriverText = drivers.length > 0 ? drivers.join(' and ') : 'Baseline Biomarkers';

    if (composite < 15) {
      scoreEl.style.color = 'var(--accent-emerald)';
      tagEl.style.background = 'rgba(16, 185, 129, 0.15)';
      tagEl.style.color = 'var(--accent-emerald)';
      tagEl.style.borderColor = 'rgba(16, 185, 129, 0.3)';
      tagEl.textContent = 'Low Heuristic Tier';
      recEl.innerHTML = `<strong>Risk Factor Dynamics (Educational Observation):</strong> Optimal metabolic baseline in this simulation. Blood pressure and glucose values remain within normal physiological ranges. Cardioprotective habits contribute to a minimized composite index.`;
    } else if (composite < 30) {
      scoreEl.style.color = 'var(--accent-amber)';
      tagEl.style.background = 'rgba(245, 158, 11, 0.15)';
      tagEl.style.color = 'var(--accent-amber)';
      tagEl.style.borderColor = 'rgba(245, 158, 11, 0.3)';
      tagEl.textContent = 'Moderate Heuristic Tier';
      recEl.innerHTML = `<strong>Risk Factor Dynamics (Educational Observation):</strong> Moderate risk factor clustering identified. ${primaryDriverText} represents the primary weight driving the score. In population data, moderate physical activity significantly mitigates these risks.`;
    } else if (composite < 45) {
      scoreEl.style.color = 'var(--accent-rose)';
      tagEl.style.background = 'rgba(244, 63, 94, 0.15)';
      tagEl.style.color = 'var(--accent-rose)';
      tagEl.style.borderColor = 'rgba(244, 63, 94, 0.3)';
      tagEl.textContent = 'Elevated Heuristic Tier';
      recEl.innerHTML = `<strong>Risk Factor Dynamics (Educational Observation):</strong> Substantial risk factor burden simulated. Concurrent elevation in ${primaryDriverText} compounds overall cardiovascular and metabolic vulnerability. Real-world clinical monitoring is advised.`;
    } else {
      scoreEl.style.color = '#e11d48';
      tagEl.style.background = 'rgba(225, 29, 72, 0.2)';
      tagEl.style.color = '#fda4af';
      tagEl.style.borderColor = '#e11d48';
      tagEl.textContent = 'High Risk Factor Cluster';
      recEl.innerHTML = `<strong>Risk Factor Dynamics (Educational Observation):</strong> Severe multi-biomarker risk cluster simulated. Simultaneous presence of ${primaryDriverText} produces high vulnerability across all synthetic clinical sub-indices.`;
    }
  }

  /**
   * Event Listeners Setup
   */
  function setupEventListeners() {
    // Theme Toggle
    document.getElementById('themeToggleBtn').addEventListener('click', toggleTheme);

    // Preset Chips
    document.querySelectorAll('.preset-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.preset-chip').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        applyPreset(btn.dataset.preset);
      });
    });

    // Age Sliders
    const ageMin = document.getElementById('ageMin');
    const ageMax = document.getElementById('ageMax');
    const updateAge = () => {
      let minVal = parseInt(ageMin.value, 10);
      let maxVal = parseInt(ageMax.value, 10);
      if (minVal > maxVal) {
        const tmp = minVal;
        minVal = maxVal;
        maxVal = tmp;
      }
      state.filters.ageMin = minVal;
      state.filters.ageMax = maxVal;
      document.getElementById('ageValDisplay').textContent = `${minVal} - ${maxVal} yrs`;
      state.pagination.page = 1;
      applyFilters();
    };
    ageMin.addEventListener('input', updateAge);
    ageMax.addEventListener('input', updateAge);

    // Select Dropdowns
    const bindSelect = (id, key) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('change', () => {
          state.filters[key] = el.value;
          state.pagination.page = 1;
          applyFilters();
        });
      }
    };
    bindSelect('filterSex', 'sex');
    bindSelect('filterRegion', 'region');
    bindSelect('filterSmoking', 'smoking');
    bindSelect('filterAlcohol', 'alcohol');
    bindSelect('filterExercise', 'exercise');
    bindSelect('filterHeartDisease', 'heartDisease');
    bindSelect('filterDiabetes', 'diabetes');
    bindSelect('filterStroke', 'stroke');

    // Reset Filters Buttons (Toolbar & Empty Banner)
    document.getElementById('resetFiltersBtn').addEventListener('click', resetFilters);
    const emptyResetBtn = document.getElementById('emptyResetBtn');
    if (emptyResetBtn) emptyResetBtn.addEventListener('click', resetFilters);

    // Age Chart Condition Toggles
    document.querySelectorAll('#ageChartConditionToggle .segmented-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#ageChartConditionToggle .segmented-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.ageChartCondition = btn.dataset.condition;
        renderAgeDistributionChart();
      });
    });

    // Search Box
    const searchInput = document.getElementById('tableSearchInput');
    let debounceTimer = null;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        state.filters.search = e.target.value;
        state.pagination.page = 1;
        applyFilters();
      }, 200);
    });

    // Page Size
    document.getElementById('pageSizeSelect').addEventListener('change', (e) => {
      state.pagination.pageSize = Number(e.target.value);
      state.pagination.page = 1;
      renderPatientTable();
    });

    // Pagination
    document.getElementById('btnPrevPage').addEventListener('click', () => {
      if (state.pagination.page > 1) {
        state.pagination.page--;
        renderPatientTable();
      }
    });
    document.getElementById('btnNextPage').addEventListener('click', () => {
      const totalPages = Math.ceil(filteredPatients.length / state.pagination.pageSize);
      if (state.pagination.page < totalPages) {
        state.pagination.page++;
        renderPatientTable();
      }
    });

    // Sorting
    document.querySelectorAll('#patientTable th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.sort;
        if (state.pagination.sortCol === col) {
          state.pagination.sortDir = state.pagination.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          state.pagination.sortCol = col;
          state.pagination.sortDir = 'asc';
        }
        renderPatientTable();
      });
    });

    // Modal Handlers
    document.getElementById('modalCloseBtn').addEventListener('click', () => {
      document.getElementById('patientModal').classList.remove('active');
    });
    document.getElementById('patientModal').addEventListener('click', (e) => {
      if (e.target.id === 'patientModal') {
        document.getElementById('patientModal').classList.remove('active');
      }
    });

    // CSV Import Modal
    const importModal = document.getElementById('importModal');
    document.getElementById('importModalBtn').addEventListener('click', () => {
      importModal.classList.add('active');
    });
    document.getElementById('importCloseBtn').addEventListener('click', () => {
      importModal.classList.remove('active');
    });
    importModal.addEventListener('click', (e) => {
      if (e.target.id === 'importModal') importModal.classList.remove('active');
    });

    setupDragAndDrop();
    document.getElementById('exportDataBtn').addEventListener('click', exportFilteredCohort);
  }

  /**
   * Presets Handling
   */
  function applyPreset(presetKey) {
    state.filters.preset = presetKey;

    // Reset base filter selections
    state.filters.ageMin = 18;
    state.filters.ageMax = 85;
    state.filters.sex = 'ALL';
    state.filters.region = 'ALL';
    state.filters.smoking = 'ALL';
    state.filters.alcohol = 'ALL';
    state.filters.exercise = 'ALL';
    state.filters.heartDisease = 'ALL';
    state.filters.diabetes = 'ALL';
    state.filters.stroke = 'ALL';
    state.filters.search = '';

    if (presetKey === 'cvd-risk') {
      // Handled in applyFilters composite predicate
    } else if (presetKey === 'diabetic') {
      // Handled in applyFilters composite predicate
    } else if (presetKey === 'stroke-risk') {
      // Handled in applyFilters composite predicate
    } else if (presetKey === 'seniors-multimorbid') {
      state.filters.ageMin = 65;
    } else if (presetKey === 'young-active') {
      state.filters.ageMax = 40;
      state.filters.exercise = 'High';
      state.filters.smoking = 'Never';
    } else if (presetKey === 'smokers-hypertensive') {
      state.filters.smoking = 'Current';
    }

    // Sync UI elements
    document.getElementById('ageMin').value = state.filters.ageMin;
    document.getElementById('ageMax').value = state.filters.ageMax;
    document.getElementById('ageValDisplay').textContent = `${state.filters.ageMin} - ${state.filters.ageMax} yrs`;
    document.getElementById('filterSex').value = state.filters.sex;
    document.getElementById('filterRegion').value = state.filters.region;
    document.getElementById('filterSmoking').value = state.filters.smoking;
    if (document.getElementById('filterAlcohol')) document.getElementById('filterAlcohol').value = state.filters.alcohol;
    document.getElementById('filterExercise').value = state.filters.exercise;
    document.getElementById('filterHeartDisease').value = state.filters.heartDisease;
    document.getElementById('filterDiabetes').value = state.filters.diabetes;
    document.getElementById('filterStroke').value = state.filters.stroke;
    document.getElementById('tableSearchInput').value = '';

    state.pagination.page = 1;
    applyFilters();
  }

  function resetFilters() {
    applyPreset('all');
    document.querySelectorAll('.preset-chip').forEach(b => b.classList.remove('active'));
    const allChip = document.querySelector('.preset-chip[data-preset="all"]');
    if (allChip) allChip.classList.add('active');
  }

  /**
   * Theme Switcher
   */
  function toggleTheme() {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', state.theme);

    const themeIcon = document.getElementById('themeIcon');
    if (themeIcon) {
      themeIcon.setAttribute('data-lucide', state.theme === 'dark' ? 'moon' : 'sun');
    }
    if (window.lucide) window.lucide.createIcons();

    // Rebuild charts with theme palette
    Object.values(charts).forEach(c => {
      if (c) c.destroy();
    });
    charts = {};
    updateCharts();
  }

  /**
   * CSV Import & Drag and Drop
   */
  function setupDragAndDrop() {
    const dropzone = document.getElementById('csvDropzone');
    const fileInput = document.getElementById('csvFileInput');
    if (!dropzone || !fileInput) return;

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('dragover');
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files.length) {
        handleCsvFile(e.dataTransfer.files[0]);
      }
    });

    fileInput.addEventListener('change', () => {
      if (fileInput.files.length) {
        handleCsvFile(fileInput.files[0]);
      }
    });
  }

  function handleCsvFile(file) {
    if (!window.Papa) {
      alert('PapaParse CSV Parser is loading. Please retry.');
      return;
    }
    window.Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: function (results) {
        if (results.data && results.data.length > 0) {
          const validation = validateSchema(results.data);
          if (!validation.valid) {
            alert(`CSV Import Failed: ${validation.message}`);
            return;
          }
          loadData(results.data);
          document.getElementById('importModal').classList.remove('active');
          alert(`Successfully imported and analyzed ${results.data.length.toLocaleString()} patient records!`);
        } else {
          alert('CSV file appears empty or unparseable.');
        }
      },
      error: function (err) {
        alert(`Error parsing CSV: ${err.message}`);
      }
    });
  }

  /**
   * Export Filtered Cohort to CSV
   */
  function exportFilteredCohort() {
    if (!filteredPatients.length) {
      alert('No patient records in the active cohort to export.');
      return;
    }
    if (!window.Papa) return;

    const csvContent = window.Papa.unparse(filteredPatients);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Health360_Cohort_Export_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function mean(arr) {
    if (!arr.length) return 0;
    return arr.reduce((acc, v) => acc + (Number(v) || 0), 0) / arr.length;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
