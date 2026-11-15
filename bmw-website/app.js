/**
 * BMW Showcase & Interactive Experience - Application Logic
 * Implements:
 * 1. Showcase Models Grid Rendering, Category Filtering, Live Search & Sorting
 * 2. Quick Specs Modal Dialog & Accessibility Management
 * 3. Studio 360° Interactive Vehicle Configurator (Color Swatches, Wheels, Calipers, Upholstery, Packages, Price Engine)
 * 4. Dynamic Side-by-Side Specifications Comparison Matrix
 * 5. Toast Notification System & Configuration Garage (LocalStorage Persistence)
 * 6. Responsive Navigation Drawer, Sticky Header & Form Enhancements
 */

(function () {
  'use strict';

  // Ensure BMW Data Service is available
  const DataService = window.BMWDataService || {
    getCategories: () => window.BMW_CATEGORIES || [],
    getAllModels: () => window.BMW_MODELS_DATA || [],
    getModelsByCategory: (cat) => (window.BMW_MODELS_DATA || []).filter(m => !cat || cat === 'all' || m.categories.includes(cat)),
    getModelById: (id) => (window.BMW_MODELS_DATA || []).find(m => m.id === id),
    calculateConfiguredPrice: (id, opts) => ({ total: 0, formatted: '$0', breakdown: [] })
  };

  // State Management
  const AppState = {
    activeCategory: 'all',
    searchQuery: '',
    sortBy: 'featured',
    configurator: {
      modelId: 'm3-competition',
      colorId: 'isle-of-man-green',
      wheelId: 'style-826m-black',
      caliperColor: '#0653B6',
      caliperName: 'M Sport Blue',
      caliperPrice: 0,
      interiorId: 'black-merino',
      packageIds: ['executive-pkg'],
      cameraAngle: 'front'
    },
    comparison: {
      vehicleA: 'm3-competition',
      vehicleB: 'i7-xdrive60'
    }
  };

  // DOM Elements Cache
  const DOM = {
    // Nav & Header
    mainHeader: document.getElementById('mainHeader'),
    mobileNavToggle: document.getElementById('mobileNavToggle'),
    mobileDrawer: document.getElementById('mobileDrawer'),
    searchTriggerBtn: document.getElementById('searchTriggerBtn'),

    // Showcase
    filterButtons: document.querySelectorAll('.filter-btn'),
    modelSearchInput: document.getElementById('modelSearchInput'),
    modelSortSelect: document.getElementById('modelSortSelect'),
    modelsGrid: document.getElementById('modelsGrid'),

    // Modal
    quickViewModal: document.getElementById('quickViewModal'),
    modalBadge: document.getElementById('modalBadge'),
    modalTitle: document.getElementById('modalTitle'),
    modalBody: document.getElementById('modalBody'),
    modalCloseBtn: document.getElementById('modalCloseBtn'),
    modalCloseAction: document.getElementById('modalCloseAction'),
    modalConfigureAction: document.getElementById('modalConfigureAction'),

    // Configurator Stage
    stageModelTitle: document.getElementById('stageModelTitle'),
    stageActiveColorLabel: document.getElementById('stageActiveColorLabel'),
    svgCarBody: document.getElementById('svgCarBody'),
    svgFrontWheel: document.getElementById('svgFrontWheel'),
    svgRearWheel: document.getElementById('svgRearWheel'),
    svgCaliperFront: document.getElementById('svgCaliperFront'),
    svgCaliperRear: document.getElementById('svgCaliperRear'),
    cockpitOverlay: document.getElementById('cockpitOverlay'),
    cockpitTint: document.getElementById('cockpitTint'),
    carVisualFrame: document.getElementById('carVisualFrame'),
    viewToggleButtons: document.querySelectorAll('.view-toggle-btn'),
    resetConfigBtn: document.getElementById('resetConfigBtn'),

    // Live Specs in Configurator
    configSpecHp: document.getElementById('configSpecHp'),
    configSpec060: document.getElementById('configSpec060'),
    configSpecDrivetrain: document.getElementById('configSpecDrivetrain'),
    configSpecEngine: document.getElementById('configSpecEngine'),

    // Configurator Controls
    configModelSelect: document.getElementById('configModelSelect'),
    colorSwatchesContainer: document.getElementById('colorSwatchesContainer'),
    wheelOptionsContainer: document.getElementById('wheelOptionsContainer'),
    caliperSwatches: document.getElementById('caliperSwatches'),
    interiorCardsContainer: document.getElementById('interiorCardsContainer'),
    packagesList: document.getElementById('packagesList'),

    // Configurator Pricing
    configBasePriceDisplay: document.getElementById('configBasePriceDisplay'),
    configOptionsPriceDisplay: document.getElementById('configOptionsPriceDisplay'),
    configTotalMSRP: document.getElementById('configTotalMSRP'),
    configMonthlyEst: document.getElementById('configMonthlyEst'),
    saveBuildBtn: document.getElementById('saveBuildBtn'),
    orderConsultationBtn: document.getElementById('orderConsultationBtn'),

    // Comparison Matrix
    compareSelectA: document.getElementById('compareSelectA'),
    compareSelectB: document.getElementById('compareSelectB'),
    comparisonTable: document.getElementById('comparisonTable'),
    compColAHeader: document.getElementById('compColAHeader'),
    compColBHeader: document.getElementById('compColBHeader'),
    compPowertrainA: document.getElementById('compPowertrainA'),
    compPowertrainB: document.getElementById('compPowertrainB'),
    compHpA: document.getElementById('compHpA'),
    compHpB: document.getElementById('compHpB'),
    compAccelA: document.getElementById('compAccelA'),
    compAccelB: document.getElementById('compAccelB'),
    compTopSpeedA: document.getElementById('compTopSpeedA'),
    compTopSpeedB: document.getElementById('compTopSpeedB'),
    compDrivetrainA: document.getElementById('compDrivetrainA'),
    compDrivetrainB: document.getElementById('compDrivetrainB'),
    compEfficiencyA: document.getElementById('compEfficiencyA'),
    compEfficiencyB: document.getElementById('compEfficiencyB'),
    compChargingA: document.getElementById('compChargingA'),
    compChargingB: document.getElementById('compChargingB'),
    compInterfaceA: document.getElementById('compInterfaceA'),
    compInterfaceB: document.getElementById('compInterfaceB'),
    compMSRPA: document.getElementById('compMSRPA'),
    compMSRPB: document.getElementById('compMSRPB'),

    // Toast & Form Alerts
    toastNotification: document.getElementById('toastNotification'),
    toastTitle: document.getElementById('toastTitle'),
    toastMessage: document.getElementById('toastMessage'),
    testDriveForm: document.getElementById('testDriveForm'),
    testDriveAlert: document.getElementById('testDriveAlert'),
    newsletterForm: document.getElementById('newsletterForm')
  };

  /* ==========================================================================
     1. MODELS SHOWCASE & CATEGORY FILTERS
     ========================================================================== */

  // High quality curated vehicle imagery fallback map
  const MODEL_IMAGES = {
    'm3-competition': 'https://images.unsplash.com/photo-1617814076367-b759c7d7e738?auto=format&fit=crop&w=900&q=80',
    'm4-competition': 'https://images.unsplash.com/photo-1580273916550-e323be2ae537?auto=format&fit=crop&w=900&q=80',
    'm5-sedan': 'https://images.unsplash.com/photo-1555215695-3004980ad54e?auto=format&fit=crop&w=900&q=80',
    'i4-m50': 'https://images.unsplash.com/photo-1553440569-bcc63803a83d?auto=format&fit=crop&w=900&q=80',
    'i7-xdrive60': 'https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&w=900&q=80',
    'ix-m60': 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=900&q=80',
    'x5-m-competition': 'https://images.unsplash.com/photo-1542282088-72c9c27ed0cd?auto=format&fit=crop&w=900&q=80',
    '760i-xdrive': 'https://images.unsplash.com/photo-1555215695-3004980ad54e?auto=format&fit=crop&w=1200&q=80'
  };

  function getBadgeMarkup(model) {
    let badges = '';
    if (model.categories.includes('m-power')) {
      badges += '<span class="badge badge-m">///M POWER</span>';
    }
    if (model.categories.includes('bmw-i')) {
      badges += '<span class="badge badge-electric">100% ELECTRIC</span>';
    }
    if (model.categories.includes('luxury')) {
      badges += '<span class="badge badge-luxury">7 SERIES LUXURY</span>';
    }
    if (model.categories.includes('bmw-x')) {
      badges += '<span class="badge badge-tech">SAV xDRIVE</span>';
    }
    return badges;
  }

  function renderModelsGrid() {
    if (!DOM.modelsGrid) return;

    let models = DataService.getAllModels();

    // 1. Filter by category
    if (AppState.activeCategory && AppState.activeCategory !== 'all') {
      models = models.filter(m => m.categories.includes(AppState.activeCategory));
    }

    // 2. Filter by search query
    if (AppState.searchQuery && AppState.searchQuery.trim() !== '') {
      const q = AppState.searchQuery.toLowerCase().trim();
      models = models.filter(m => {
        return (
          m.name.toLowerCase().includes(q) ||
          m.tagline.toLowerCase().includes(q) ||
          m.series.toLowerCase().includes(q) ||
          m.specs.powertrain.toLowerCase().includes(q) ||
          m.specs.horsepowerDisplay.toLowerCase().includes(q) ||
          (m.keyFeatures && m.keyFeatures.some(f => f.toLowerCase().includes(q)))
        );
      });
    }

    // 3. Sort models
    switch (AppState.sortBy) {
      case 'hp-desc':
        models.sort((a, b) => b.specs.horsepower - a.specs.horsepower);
        break;
      case 'accel-asc':
        models.sort((a, b) => a.specs.acceleration - b.specs.acceleration);
        break;
      case 'price-asc':
        models.sort((a, b) => a.basePrice - b.basePrice);
        break;
      case 'price-desc':
        models.sort((a, b) => b.basePrice - a.basePrice);
        break;
      case 'featured':
      default:
        // natural curated order from dataset
        break;
    }

    // Render empty state if no models match
    if (models.length === 0) {
      DOM.modelsGrid.innerHTML = `
        <div class="models-empty-state" style="grid-column: 1 / -1; text-align: center; padding: 4rem 2rem; background: rgba(255,255,255,0.02); border: 1px dashed var(--border-medium); border-radius: 16px;">
          <svg style="width: 48px; height: 48px; margin: 0 auto 1.2rem; stroke: var(--text-muted);" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <h3 style="font-size: 1.3rem; margin-bottom: 0.5rem; color: var(--text-white);">No Vehicles Found</h3>
          <p style="color: var(--text-muted); max-width: 460px; margin: 0 auto 1.5rem;">We couldn't find any BMW models matching "${AppState.searchQuery}". Try searching for "M Power", "Electric", "TwinPower", or "Sedan".</p>
          <button class="btn btn-outline btn-sm" id="clearFilterBtn">Reset All Filters</button>
        </div>
      `;
      const clearBtn = document.getElementById('clearFilterBtn');
      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          AppState.activeCategory = 'all';
          AppState.searchQuery = '';
          if (DOM.modelSearchInput) DOM.modelSearchInput.value = '';
          updateActiveFilterTabs();
          renderModelsGrid();
        });
      }
      return;
    }

    // Render model cards
    DOM.modelsGrid.innerHTML = models.map(model => {
      const imgUrl = MODEL_IMAGES[model.id] || MODEL_IMAGES['m3-competition'];
      const badgesHtml = getBadgeMarkup(model);
      const isElectric = model.categories.includes('bmw-i');
      const thirdSpecLabel = isElectric ? 'Electric Range' : 'Top Speed';
      const thirdSpecVal = isElectric ? (model.specs.electricRange.replace('Up to ', '')) : model.specs.topSpeed;

      return `
        <article class="model-card" data-category="${model.categories.join(' ')}" data-id="${model.id}">
          <div class="card-badge-container">
            ${badgesHtml}
          </div>
          <div class="card-image-wrap">
            <img 
              src="${imgUrl}" 
              alt="${model.name}" 
              class="card-img" 
              loading="lazy"
            >
            <div class="image-gradient-tint"></div>
          </div>
          <div class="card-content">
            <div class="card-title-group">
              <span class="model-year">2025</span>
              <h3 class="model-name">${model.name}</h3>
              <p class="model-sub">${model.specs.powertrain} &bull; ${model.bodyType}</p>
            </div>
            
            <div class="card-specs-grid">
              <div class="spec-item">
                <span class="spec-val">${model.specs.horsepower} HP</span>
                <span class="spec-lbl">Horsepower</span>
              </div>
              <div class="spec-item">
                <span class="spec-val">${model.specs.acceleration}s</span>
                <span class="spec-lbl">0-60 MPH</span>
              </div>
              <div class="spec-item">
                <span class="spec-val">${thirdSpecVal}</span>
                <span class="spec-lbl">${thirdSpecLabel}</span>
              </div>
            </div>

            <div class="card-price-row">
              <div class="price-block">
                <span class="price-label">Starting MSRP</span>
                <span class="price-value">${model.priceFormatted}</span>
              </div>
              <div class="card-actions">
                <button class="btn btn-sm btn-outline quick-view-btn" data-model="${model.id}" aria-label="Quick specs for ${model.name}">Quick Specs</button>
                <a href="#customizer" class="btn btn-sm btn-primary configure-btn" data-model="${model.id}" aria-label="Customize ${model.name}">Customize</a>
              </div>
            </div>
          </div>
        </article>
      `;
    }).join('');

    attachCardEventListeners();
  }

  function updateActiveFilterTabs() {
    DOM.filterButtons.forEach(btn => {
      const cat = btn.getAttribute('data-category');
      const isActive = cat === AppState.activeCategory;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
  }

  function attachCardEventListeners() {
    // Quick View buttons
    document.querySelectorAll('.quick-view-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const modelId = e.currentTarget.getAttribute('data-model');
        openQuickViewModal(modelId);
      });
    });

    // Configure buttons
    document.querySelectorAll('.configure-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const modelId = e.currentTarget.getAttribute('data-model');
        selectModelForConfigurator(modelId);
      });
    });
  }

  function setupFilterEventListeners() {
    // Category tabs
    DOM.filterButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const cat = btn.getAttribute('data-category');
        AppState.activeCategory = cat;
        updateActiveFilterTabs();
        renderModelsGrid();
      });
    });

    // Search input with debounce
    if (DOM.modelSearchInput) {
      let debounceTimer;
      DOM.modelSearchInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          AppState.searchQuery = e.target.value;
          renderModelsGrid();
        }, 200);
      });
    }

    // Sort select
    if (DOM.modelSortSelect) {
      DOM.modelSortSelect.addEventListener('change', (e) => {
        AppState.sortBy = e.target.value;
        renderModelsGrid();
      });
    }

    // Search header trigger
    if (DOM.searchTriggerBtn) {
      DOM.searchTriggerBtn.addEventListener('click', () => {
        const modelsSec = document.getElementById('models');
        if (modelsSec) {
          modelsSec.scrollIntoView({ behavior: 'smooth' });
          if (DOM.modelSearchInput) {
            setTimeout(() => DOM.modelSearchInput.focus(), 600);
          }
        }
      });
    }
  }

  /* ==========================================================================
     2. QUICK SPECS MODAL DIALOG
     ========================================================================== */

  function openQuickViewModal(modelId) {
    const model = DataService.getModelById(modelId);
    if (!model || !DOM.quickViewModal) return;

    if (DOM.modalBadge) {
      DOM.modalBadge.textContent = model.badge || 'FLAGSHIP';
      DOM.modalBadge.style.borderColor = model.badgeColor || 'var(--bmw-blue)';
    }

    if (DOM.modalTitle) {
      DOM.modalTitle.textContent = model.name;
    }

    if (DOM.modalConfigureAction) {
      DOM.modalConfigureAction.setAttribute('data-model', model.id);
      DOM.modalConfigureAction.onclick = (e) => {
        closeQuickViewModal();
        selectModelForConfigurator(model.id);
      };
    }

    if (DOM.modalBody) {
      const imgUrl = MODEL_IMAGES[model.id] || MODEL_IMAGES['m3-competition'];
      DOM.modalBody.innerHTML = `
        <div class="modal-vehicle-hero" style="position: relative; border-radius: 12px; overflow: hidden; margin-bottom: 1.5rem; background: #131417;">
          <img src="${imgUrl}" alt="${model.name}" style="width: 100%; height: 220px; object-fit: cover;">
          <div style="position: absolute; bottom: 0; left: 0; right: 0; padding: 1rem 1.25rem; background: linear-gradient(180deg, transparent, rgba(11,12,16,0.95));">
            <p style="font-size: 0.95rem; color: var(--bmw-m-cyan); font-weight: 600; margin: 0;">${model.tagline}</p>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; margin-bottom: 1.5rem;">
          <div style="background: rgba(255,255,255,0.03); padding: 1rem; border-radius: 8px; border: 1px solid var(--border-subtle);">
            <span style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase;">Powertrain</span>
            <p style="font-weight: 600; font-size: 0.95rem; color: var(--text-white); margin-top: 2px;">${model.specs.powertrain}</p>
          </div>
          <div style="background: rgba(255,255,255,0.03); padding: 1rem; border-radius: 8px; border: 1px solid var(--border-subtle);">
            <span style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase;">0-60 MPH Acceleration</span>
            <p style="font-weight: 700; font-size: 1.1rem; color: var(--bmw-m-cyan); margin-top: 2px;">${model.specs.accelerationDisplay}</p>
          </div>
          <div style="background: rgba(255,255,255,0.03); padding: 1rem; border-radius: 8px; border: 1px solid var(--border-subtle);">
            <span style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase;">Horsepower & Torque</span>
            <p style="font-weight: 600; font-size: 0.95rem; color: var(--text-white); margin-top: 2px;">${model.specs.horsepowerDisplay} &bull; ${model.specs.torque}</p>
          </div>
          <div style="background: rgba(255,255,255,0.03); padding: 1rem; border-radius: 8px; border: 1px solid var(--border-subtle);">
            <span style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase;">Drivetrain & Transmission</span>
            <p style="font-weight: 600; font-size: 0.95rem; color: var(--text-white); margin-top: 2px;">${model.specs.drivetrain}</p>
          </div>
        </div>

        <h4 style="font-size: 0.95rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary); margin-bottom: 0.75rem;">Key Engineering Highlights</h4>
        <ul style="list-style: none; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 1.5rem;">
          ${(model.keyFeatures || []).map(feat => `
            <li style="display: flex; align-items: baseline; gap: 8px; font-size: 0.88rem; color: var(--text-secondary);">
              <span style="color: var(--bmw-m-cyan); font-weight: bold;">&bull;</span>
              <span>${feat}</span>
            </li>
          `).join('')}
        </ul>

        <div style="display: flex; justify-content: space-between; align-items: center; padding: 1rem; background: rgba(6, 83, 182, 0.08); border: 1px solid rgba(6, 83, 182, 0.3); border-radius: 8px;">
          <div>
            <span style="font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted);">Base Starting MSRP</span>
            <p style="font-size: 1.35rem; font-weight: 800; color: var(--text-white); margin: 0;">${model.priceFormatted}</p>
          </div>
          <span style="font-size: 0.8rem; color: var(--text-muted);">*Excludes destination, tax & dealer fees</span>
        </div>
      `;
    }

    DOM.quickViewModal.classList.add('active');
    DOM.quickViewModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeQuickViewModal() {
    if (!DOM.quickViewModal) return;
    DOM.quickViewModal.classList.remove('active');
    DOM.quickViewModal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  function setupModalEventListeners() {
    if (!DOM.quickViewModal) return;

    if (DOM.modalCloseBtn) {
      DOM.modalCloseBtn.addEventListener('click', closeQuickViewModal);
    }
    if (DOM.modalCloseAction) {
      DOM.modalCloseAction.addEventListener('click', closeQuickViewModal);
    }

    // Click backdrop to dismiss
    DOM.quickViewModal.addEventListener('click', (e) => {
      if (e.target === DOM.quickViewModal) {
        closeQuickViewModal();
      }
    });

    // ESC key to dismiss
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && DOM.quickViewModal.classList.contains('active')) {
        closeQuickViewModal();
      }
    });
  }

  /* ==========================================================================
     3. STUDIO 360° INTERACTIVE VEHICLE CONFIGURATOR
     ========================================================================== */

  function populateConfiguratorModelOptions() {
    if (!DOM.configModelSelect) return;

    const allModels = DataService.getAllModels();
    DOM.configModelSelect.innerHTML = allModels.map(m => {
      return `<option value="${m.id}" ${m.id === AppState.configurator.modelId ? 'selected' : ''}>${m.name} — From ${m.priceFormatted}</option>`;
    }).join('');
  }

  function selectModelForConfigurator(modelId) {
    const model = DataService.getModelById(modelId);
    if (!model) return;

    AppState.configurator.modelId = model.id;
    // Set default color
    if (model.colors && model.colors.length > 0) {
      AppState.configurator.colorId = model.colors[0].id;
    }
    // Set default wheel
    if (model.wheels && model.wheels.length > 0) {
      AppState.configurator.wheelId = model.wheels[0].id;
    }
    // Set default interior
    if (model.interiors && model.interiors.length > 0) {
      AppState.configurator.interiorId = model.interiors[0].id;
    }
    // Default package
    AppState.configurator.packageIds = model.packages && model.packages.length > 0 ? [model.packages[0].id] : [];
    // Default angle
    AppState.configurator.cameraAngle = 'front';

    // Synchronize select dropdown
    if (DOM.configModelSelect) {
      DOM.configModelSelect.value = model.id;
    }

    // Refresh UI components
    renderConfiguratorUI();

    // Scroll smoothly to customizer
    const customizerEl = document.getElementById('customizer');
    if (customizerEl) {
      customizerEl.scrollIntoView({ behavior: 'smooth' });
    }
  }

  function renderConfiguratorUI() {
    const model = DataService.getModelById(AppState.configurator.modelId);
    if (!model) return;

    // Update Stage Titles
    if (DOM.stageModelTitle) {
      DOM.stageModelTitle.textContent = model.name;
    }

    // Find active color
    const activeColor = model.colors.find(c => c.id === AppState.configurator.colorId) || model.colors[0];
    if (DOM.stageActiveColorLabel) {
      const priceNotice = activeColor.priceDelta > 0 ? ` (+${formatCurrency(activeColor.priceDelta)})` : '';
      DOM.stageActiveColorLabel.textContent = `${activeColor.name} • ${activeColor.finish}${priceNotice}`;
    }

    // Update SVG Car Body Color
    if (DOM.svgCarBody) {
      DOM.svgCarBody.style.transition = 'fill 0.45s ease';
      DOM.svgCarBody.setAttribute('fill', activeColor.hex);
    }

    // Update Calipers
    if (DOM.svgCaliperFront) {
      DOM.svgCaliperFront.setAttribute('stroke', AppState.configurator.caliperColor);
    }
    if (DOM.svgCaliperRear) {
      DOM.svgCaliperRear.setAttribute('stroke', AppState.configurator.caliperColor);
    }

    // Update Quick Specs strip
    if (DOM.configSpecHp) DOM.configSpecHp.textContent = `${model.specs.horsepower} HP`;
    if (DOM.configSpec060) DOM.configSpec060.textContent = `${model.specs.acceleration}s`;
    if (DOM.configSpecDrivetrain) DOM.configSpecDrivetrain.textContent = model.specs.drivetrain.split(' ')[0] + ' ' + (model.specs.drivetrain.includes('AWD') || model.specs.drivetrain.includes('All-Wheel') ? 'AWD' : 'RWD');
    if (DOM.configSpecEngine) DOM.configSpecEngine.textContent = model.specs.powertrain.split(' ')[0] + ' ' + (model.specs.powertrain.includes('Electric') ? 'Electric' : 'TwinPower');

    // Render Color Swatches
    renderColorSwatches(model);

    // Render Wheels
    renderWheelOptions(model);

    // Render Caliper Swatches
    renderCaliperOptions();

    // Render Interior options
    renderInteriorOptions(model);

    // Render Packages
    renderPackageOptions(model);

    // Update Price Engine
    updateConfiguratorPricing(model);
  }

  function renderColorSwatches(model) {
    if (!DOM.colorSwatchesContainer) return;

    DOM.colorSwatchesContainer.innerHTML = model.colors.map(color => {
      const isActive = color.id === AppState.configurator.colorId;
      const priceText = color.priceDelta > 0 ? ` (+$${color.priceDelta.toLocaleString('en-US')})` : '';
      return `
        <button 
          class="color-swatch-btn ${isActive ? 'active' : ''}" 
          data-color-id="${color.id}" 
          data-color-hex="${color.hex}" 
          data-color-name="${color.name}"
          title="${color.name}${priceText}" 
          aria-checked="${isActive ? 'true' : 'false'}" 
          role="radio"
        >
          <span class="swatch-circle" style="background-color: ${color.hex}; ${color.hex === '#f5f6f8' ? 'border: 1px solid #71767b;' : ''}"></span>
          <span class="swatch-label">${color.name.split(' ')[0]}${color.priceDelta > 0 ? ' (+$)' : ''}</span>
        </button>
      `;
    }).join('');

    // Attach swatch events
    DOM.colorSwatchesContainer.querySelectorAll('.color-swatch-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const colorId = btn.getAttribute('data-color-id');
        AppState.configurator.colorId = colorId;
        renderConfiguratorUI();
      });
    });
  }

  function renderWheelOptions(model) {
    if (!DOM.wheelOptionsContainer) return;

    DOM.wheelOptionsContainer.innerHTML = model.wheels.map(wheel => {
      const isChecked = wheel.id === AppState.configurator.wheelId;
      const priceFormatted = wheel.priceDelta > 0 ? `+$${wheel.priceDelta.toLocaleString('en-US')}` : 'Standard Included';

      return `
        <label class="option-radio-card ${isChecked ? 'active' : ''}">
          <input type="radio" name="wheelDesign" value="${wheel.id}" ${isChecked ? 'checked' : ''}>
          <div class="option-radio-content">
            <span class="option-name">${wheel.name}</span>
            <span class="option-price">${priceFormatted}</span>
          </div>
        </label>
      `;
    }).join('');

    // Attach wheel radio events
    DOM.wheelOptionsContainer.querySelectorAll('input[name="wheelDesign"]').forEach(input => {
      input.addEventListener('change', (e) => {
        AppState.configurator.wheelId = e.target.value;
        renderConfiguratorUI();
      });
    });
  }

  function renderCaliperOptions() {
    if (!DOM.caliperSwatches) return;

    const caliperPresets = [
      { id: 'blue', color: '#0653B6', name: 'M Sport Blue', price: 0 },
      { id: 'red', color: '#e2001a', name: 'M Sport Red', price: 0 },
      { id: 'gold', color: '#d4af37', name: 'M Carbon Ceramic Gold', price: 8500 }
    ];

    DOM.caliperSwatches.innerHTML = caliperPresets.map(cal => {
      const isActive = AppState.configurator.caliperColor === cal.color;
      const priceLabel = cal.price > 0 ? ' (+$$)' : '';
      return `
        <button 
          class="caliper-btn ${isActive ? 'active' : ''}" 
          data-caliper-color="${cal.color}" 
          data-caliper-name="${cal.name}" 
          data-caliper-price="${cal.price}" 
          title="${cal.name} ${cal.price > 0 ? '(+$8,500)' : '(Included)'}"
        >
          <span class="caliper-dot" style="background:${cal.color};"></span> ${cal.name.split(' ').pop()}${priceLabel}
        </button>
      `;
    }).join('');

    DOM.caliperSwatches.querySelectorAll('.caliper-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        AppState.configurator.caliperColor = btn.getAttribute('data-caliper-color');
        AppState.configurator.caliperName = btn.getAttribute('data-caliper-name');
        AppState.configurator.caliperPrice = parseInt(btn.getAttribute('data-caliper-price') || '0', 10);
        renderConfiguratorUI();
      });
    });
  }

  function renderInteriorOptions(model) {
    if (!DOM.interiorCardsContainer) return;

    DOM.interiorCardsContainer.innerHTML = model.interiors.map(interior => {
      const isChecked = interior.id === AppState.configurator.interiorId;
      const priceLabel = interior.priceDelta > 0 ? `+$${interior.priceDelta.toLocaleString('en-US')}` : 'Included';

      return `
        <label class="interior-card ${isChecked ? 'active' : ''}">
          <input type="radio" name="interiorTrim" value="${interior.id}" ${isChecked ? 'checked' : ''}>
          <div class="interior-swatch-box" style="background: ${interior.hex}; border: 1px solid var(--border-medium);"></div>
          <div class="interior-card-info">
            <span class="interior-name">${interior.name}</span>
            <span class="interior-price">${priceLabel}</span>
          </div>
        </label>
      `;
    }).join('');

    // Attach interior radio events
    DOM.interiorCardsContainer.querySelectorAll('input[name="interiorTrim"]').forEach(input => {
      input.addEventListener('change', (e) => {
        AppState.configurator.interiorId = e.target.value;
        renderConfiguratorUI();
      });
    });
  }

  function renderPackageOptions(model) {
    if (!DOM.packagesList) return;

    DOM.packagesList.innerHTML = model.packages.map(pkg => {
      const isChecked = AppState.configurator.packageIds.includes(pkg.id);
      return `
        <label class="package-checkbox-item ${isChecked ? 'checked-pkg' : ''}">
          <input type="checkbox" class="package-check" data-package-id="${pkg.id}" value="${pkg.id}" ${isChecked ? 'checked' : ''}>
          <div class="pkg-info">
            <span class="pkg-title">${pkg.name}</span>
            <span class="pkg-desc">${pkg.description}</span>
          </div>
          <span class="pkg-price">+$${pkg.price.toLocaleString('en-US')}</span>
        </label>
      `;
    }).join('');

    // Attach package checkbox events
    DOM.packagesList.querySelectorAll('.package-check').forEach(box => {
      box.addEventListener('change', () => {
        const selected = [];
        DOM.packagesList.querySelectorAll('.package-check:checked').forEach(c => {
          selected.push(c.getAttribute('data-package-id'));
        });
        AppState.configurator.packageIds = selected;
        renderConfiguratorUI();
      });
    });
  }

  function updateConfiguratorPricing(model) {
    let basePrice = model.basePrice;
    let optionsSum = 0;

    // Paint delta
    const color = model.colors.find(c => c.id === AppState.configurator.colorId);
    if (color && color.priceDelta) optionsSum += color.priceDelta;

    // Wheel delta
    const wheel = model.wheels.find(w => w.id === AppState.configurator.wheelId);
    if (wheel && wheel.priceDelta) optionsSum += wheel.priceDelta;

    // Caliper delta
    if (AppState.configurator.caliperPrice) {
      optionsSum += AppState.configurator.caliperPrice;
    }

    // Interior delta
    const interior = model.interiors.find(i => i.id === AppState.configurator.interiorId);
    if (interior && interior.priceDelta) optionsSum += interior.priceDelta;

    // Packages delta
    AppState.configurator.packageIds.forEach(pkgId => {
      const pkg = model.packages.find(p => p.id === pkgId);
      if (pkg) optionsSum += pkg.price;
    });

    const destination = 995;
    const totalMSRP = basePrice + optionsSum + destination;
    // Estimated 36-month lease financing payment (with approx 0.0022 money factor & residual)
    const monthlyEstimate = Math.round((totalMSRP * 0.52) / 36);

    if (DOM.configBasePriceDisplay) {
      DOM.configBasePriceDisplay.textContent = `$${basePrice.toLocaleString('en-US')}`;
    }
    if (DOM.configOptionsPriceDisplay) {
      DOM.configOptionsPriceDisplay.textContent = optionsSum > 0 ? `+$${optionsSum.toLocaleString('en-US')}` : '$0';
    }
    if (DOM.configTotalMSRP) {
      DOM.configTotalMSRP.textContent = `$${totalMSRP.toLocaleString('en-US')}`;
    }
    if (DOM.configMonthlyEst) {
      DOM.configMonthlyEst.textContent = `$${monthlyEstimate.toLocaleString('en-US')} / mo*`;
    }
  }

  function setCameraAngle(angle) {
    AppState.configurator.cameraAngle = angle;

    DOM.viewToggleButtons.forEach(btn => {
      const a = btn.getAttribute('data-angle');
      btn.classList.toggle('active', a === angle);
    });

    if (angle === 'cockpit') {
      if (DOM.cockpitOverlay) DOM.cockpitOverlay.style.display = 'block';
      if (DOM.carVisualFrame) DOM.carVisualFrame.classList.add('view-cockpit-mode');
    } else {
      if (DOM.cockpitOverlay) DOM.cockpitOverlay.style.display = 'none';
      if (DOM.carVisualFrame) DOM.carVisualFrame.classList.remove('view-cockpit-mode');

      // Subtle isometric 3D perspective shifts on the car vector
      if (DOM.carVisualFrame) {
        if (angle === 'side') {
          DOM.carVisualFrame.style.transform = 'scale(1) rotateY(0deg)';
        } else if (angle === 'front') {
          DOM.carVisualFrame.style.transform = 'perspective(800px) rotateY(-5deg) scale(1.02)';
        } else if (angle === 'rear') {
          DOM.carVisualFrame.style.transform = 'perspective(800px) rotateY(6deg) scale(0.98)';
        }
        DOM.carVisualFrame.style.transition = 'transform 0.5s cubic-bezier(0.16, 1, 0.3, 1)';
      }
    }
  }

  function setupConfiguratorEventListeners() {
    // Model select change
    if (DOM.configModelSelect) {
      DOM.configModelSelect.addEventListener('change', (e) => {
        selectModelForConfigurator(e.target.value);
      });
    }

    // Camera view toggles
    DOM.viewToggleButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const angle = btn.getAttribute('data-angle');
        setCameraAngle(angle);
      });
    });

    // Reset Defaults button
    if (DOM.resetConfigBtn) {
      DOM.resetConfigBtn.addEventListener('click', () => {
        selectModelForConfigurator(AppState.configurator.modelId);
        showToast('Configuration Reset', 'Reset to factory default specifications.');
      });
    }

    // Save & Share Build
    if (DOM.saveBuildBtn) {
      DOM.saveBuildBtn.addEventListener('click', () => {
        const model = DataService.getModelById(AppState.configurator.modelId);
        const buildData = {
          modelId: model.id,
          modelName: model.name,
          colorId: AppState.configurator.colorId,
          wheelId: AppState.configurator.wheelId,
          interiorId: AppState.configurator.interiorId,
          packages: AppState.configurator.packageIds,
          totalPrice: DOM.configTotalMSRP ? DOM.configTotalMSRP.textContent : model.priceFormatted,
          timestamp: new Date().toISOString()
        };

        try {
          localStorage.setItem('bmw_saved_build', JSON.stringify(buildData));
        } catch (err) {
          // localStorage error handling
        }

        showToast('Configuration Saved to Garage', `Saved your bespoke ${model.name} (${buildData.totalPrice}). Reference Code: BMW-${Math.random().toString(36).substr(2, 6).toUpperCase()}`);
      });
    }

    // Send to Local BMW Center (Pre-fill test drive form)
    if (DOM.orderConsultationBtn) {
      DOM.orderConsultationBtn.addEventListener('click', () => {
        const model = DataService.getModelById(AppState.configurator.modelId);
        const testDriveSec = document.getElementById('testDriveSection');
        if (testDriveSec) {
          testDriveSec.scrollIntoView({ behavior: 'smooth' });
          const modelField = document.getElementById('tdModelSelect') || document.getElementById('preferredModel');
          if (modelField) {
            modelField.value = model.id;
          }
          showToast('Model Selected for VIP Test Drive', `Pre-selected ${model.name} for consultation.`);
        }
      });
    }
  }

  /* ==========================================================================
     4. SPECS COMPARISON MATRIX
     ========================================================================== */

  function populateComparisonSelectors() {
    const allModels = DataService.getAllModels();

    if (DOM.compareSelectA) {
      DOM.compareSelectA.innerHTML = allModels.map(m => {
        return `<option value="${m.id}" ${m.id === AppState.comparison.vehicleA ? 'selected' : ''}>${m.name}</option>`;
      }).join('');
    }

    if (DOM.compareSelectB) {
      DOM.compareSelectB.innerHTML = allModels.map(m => {
        return `<option value="${m.id}" ${m.id === AppState.comparison.vehicleB ? 'selected' : ''}>${m.name}</option>`;
      }).join('');
    }
  }

  function updateComparisonMatrix() {
    const modelA = DataService.getModelById(AppState.comparison.vehicleA);
    const modelB = DataService.getModelById(AppState.comparison.vehicleB);

    if (!modelA || !modelB) return;

    // Headers
    if (DOM.compColAHeader) DOM.compColAHeader.textContent = modelA.name;
    if (DOM.compColBHeader) DOM.compColBHeader.textContent = modelB.name;

    // Powertrain
    if (DOM.compPowertrainA) DOM.compPowertrainA.textContent = modelA.specs.powertrain;
    if (DOM.compPowertrainB) DOM.compPowertrainB.textContent = modelB.specs.powertrain;

    // Horsepower
    if (DOM.compHpA && DOM.compHpB) {
      DOM.compHpA.textContent = `${modelA.specs.horsepower} HP`;
      DOM.compHpB.textContent = `${modelB.specs.horsepower} HP`;
      DOM.compHpA.classList.toggle('highlight-val', modelA.specs.horsepower >= modelB.specs.horsepower);
      DOM.compHpB.classList.toggle('highlight-val', modelB.specs.horsepower > modelA.specs.horsepower);
    }

    // Acceleration 0-60
    if (DOM.compAccelA && DOM.compAccelB) {
      DOM.compAccelA.textContent = `${modelA.specs.acceleration} seconds`;
      DOM.compAccelB.textContent = `${modelB.specs.acceleration} seconds`;
      DOM.compAccelA.classList.toggle('highlight-val', modelA.specs.acceleration <= modelB.specs.acceleration);
      DOM.compAccelB.classList.toggle('highlight-val', modelB.specs.acceleration < modelA.specs.acceleration);
    }

    // Top Speed
    if (DOM.compTopSpeedA) DOM.compTopSpeedA.textContent = modelA.specs.topSpeed;
    if (DOM.compTopSpeedB) DOM.compTopSpeedB.textContent = modelB.specs.topSpeed;

    // Drivetrain
    if (DOM.compDrivetrainA) DOM.compDrivetrainA.textContent = modelA.specs.drivetrain;
    if (DOM.compDrivetrainB) DOM.compDrivetrainB.textContent = modelB.specs.drivetrain;

    // Efficiency / Range
    if (DOM.compEfficiencyA) {
      const isElecA = modelA.categories.includes('bmw-i');
      DOM.compEfficiencyA.textContent = isElecA ? modelA.specs.electricRange : modelA.specs.fuelEconomy;
      DOM.compEfficiencyA.classList.toggle('highlight-val', isElecA);
    }
    if (DOM.compEfficiencyB) {
      const isElecB = modelB.categories.includes('bmw-i');
      DOM.compEfficiencyB.textContent = isElecB ? modelB.specs.electricRange : modelB.specs.fuelEconomy;
      DOM.compEfficiencyB.classList.toggle('highlight-val', isElecB);
    }

    // Fast Charging / Fueling
    if (DOM.compChargingA) {
      DOM.compChargingA.textContent = modelA.categories.includes('bmw-i') ? '205 kW DC Fast Charge (10-80% in 31 min)' : 'Premium Unleaded Fuel (15.6 gal)';
    }
    if (DOM.compChargingB) {
      DOM.compChargingB.textContent = modelB.categories.includes('bmw-i') ? '195 kW DC Fast Charge (10-80% in 34 min)' : 'Premium Unleaded Fuel (18.0 gal)';
    }

    // Cockpit Interface
    if (DOM.compInterfaceA) {
      DOM.compInterfaceA.textContent = modelA.keyFeatures.find(f => f.includes('Display')) || 'BMW Curved Display with OS 8.5';
    }
    if (DOM.compInterfaceB) {
      DOM.compInterfaceB.textContent = modelB.keyFeatures.find(f => f.includes('Display')) || 'BMW Curved Display with OS 8.5 & Theatre Screen';
    }

    // Base MSRP
    if (DOM.compMSRPA) DOM.compMSRPA.textContent = modelA.priceFormatted;
    if (DOM.compMSRPB) DOM.compMSRPB.textContent = modelB.priceFormatted;
  }

  function setupComparisonEventListeners() {
    if (DOM.compareSelectA) {
      DOM.compareSelectA.addEventListener('change', (e) => {
        AppState.comparison.vehicleA = e.target.value;
        updateComparisonMatrix();
      });
    }

    if (DOM.compareSelectB) {
      DOM.compareSelectB.addEventListener('change', (e) => {
        AppState.comparison.vehicleB = e.target.value;
        updateComparisonMatrix();
      });
    }
  }

  /* ==========================================================================
     5. TOAST NOTIFICATION SYSTEM
     ========================================================================== */

  let toastHideTimer;

  function showToast(title, message) {
    if (!DOM.toastNotification) return;

    if (DOM.toastTitle) DOM.toastTitle.textContent = title;
    if (DOM.toastMessage) DOM.toastMessage.textContent = message;

    DOM.toastNotification.classList.add('show');
    clearTimeout(toastHideTimer);
    toastHideTimer = setTimeout(() => {
      DOM.toastNotification.classList.remove('show');
    }, 4500);
  }

  /* ==========================================================================
     6. NAVIGATION, FORMS & UX ENHANCEMENTS
     ========================================================================== */

  function setupHeaderAndNav() {
    // Sticky Header Scroll Blur
    window.addEventListener('scroll', () => {
      if (!DOM.mainHeader) return;
      if (window.scrollY > 40) {
        DOM.mainHeader.classList.add('scrolled');
      } else {
        DOM.mainHeader.classList.remove('scrolled');
      }
    });

    // Mobile Hamburger Drawer
    if (DOM.mobileNavToggle && DOM.mobileDrawer) {
      DOM.mobileNavToggle.addEventListener('click', () => {
        const isOpen = DOM.mobileDrawer.classList.contains('open');
        DOM.mobileDrawer.classList.toggle('open', !isOpen);
        DOM.mobileNavToggle.setAttribute('aria-expanded', !isOpen ? 'true' : 'false');
        DOM.mobileDrawer.setAttribute('aria-hidden', !isOpen ? 'false' : 'true');
      });

      // Close drawer on link click
      DOM.mobileDrawer.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', () => {
          DOM.mobileDrawer.classList.remove('open');
          DOM.mobileNavToggle.setAttribute('aria-expanded', 'false');
          DOM.mobileDrawer.setAttribute('aria-hidden', 'true');
        });
      });
    }

    // Test Drive Form Submission
    if (DOM.testDriveForm) {
      DOM.testDriveForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const alertBox = DOM.testDriveAlert;
        if (alertBox) {
          alertBox.className = 'form-alert success';
          alertBox.style.display = 'block';
          alertBox.style.marginTop = '1rem';
          alertBox.style.padding = '1rem';
          alertBox.style.borderRadius = '8px';
          alertBox.style.backgroundColor = 'rgba(0, 160, 226, 0.15)';
          alertBox.style.border = '1px solid var(--bmw-m-cyan)';
          alertBox.style.color = '#ffffff';
          alertBox.innerHTML = '<strong>VIP Reservation Confirmed!</strong> A BMW Client Advisor from your regional center will contact you within 2 business hours.';
        }
        showToast('VIP Test Drive Confirmed', 'Reservation transmitted to authorized center.');
      });
    }

    // Newsletter Form Submission
    if (DOM.newsletterForm) {
      DOM.newsletterForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = document.getElementById('newsletterEmail');
        if (input) input.value = '';
        showToast('Subscribed to BMW Privilege', 'Thank you for joining our exclusive motorsport and innovation circle.');
      });
    }
  }

  function formatCurrency(num) {
    return '$' + (num || 0).toLocaleString('en-US');
  }

  /* ==========================================================================
     INITIALIZATION LIFECYCLE
     ========================================================================== */

  function init() {
    // 1. Initialize Showcase
    updateActiveFilterTabs();
    renderModelsGrid();
    setupFilterEventListeners();

    // 2. Initialize Quick View Modal
    setupModalEventListeners();

    // 3. Initialize Configurator
    populateConfiguratorModelOptions();
    renderConfiguratorUI();
    setupConfiguratorEventListeners();

    // 4. Initialize Comparison Matrix
    populateComparisonSelectors();
    updateComparisonMatrix();
    setupComparisonEventListeners();

    // 5. Initialize Navigation & Global UX
    setupHeaderAndNav();

    // 6. Check for saved build in localStorage
    try {
      const saved = localStorage.getItem('bmw_saved_build');
      if (saved) {
        const data = JSON.parse(saved);
        if (data && data.modelId) {
          // Pre-populate configurator if saved build exists
          selectModelForConfigurator(data.modelId);
        }
      }
    } catch (e) {
      // Ignore storage restrictions
    }
  }

  // Execute on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose App API for testing/inspection
  window.BMWApp = {
    AppState,
    DataService,
    selectModelForConfigurator,
    openQuickViewModal,
    closeQuickViewModal,
    renderModelsGrid,
    updateComparisonMatrix
  };

})();
