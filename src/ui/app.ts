import { CADRenderer } from '../cad/renderer';
import { HistoryManager } from '../cad/history';
import { EditorTool, ToolMode } from '../tools/editor';
import { MeasureManager } from '../tools/measure';
import { parseCadFile } from '../cad/parser';
import { createSampleDocument } from '../cad/sample';
import { CADDocument, CADEntity, Point2D } from '../cad/types';
import { downloadDxfFile } from '../cad/exporter';

export class AppUI {
  private renderer: CADRenderer;
  private history: HistoryManager;
  private editor: EditorTool;
  private measure: MeasureManager;

  // UI Elements
  private canvasEl: HTMLCanvasElement;
  private fileInputEl: HTMLInputElement;
  private btnLoadSample: HTMLButtonElement;
  private btnExport: HTMLButtonElement;
  private btnFitView: HTMLButtonElement;
  private btnToggleBg: HTMLButtonElement;
  private btnDeleteSelected: HTMLButtonElement;

  // Tool buttons
  private toolButtons: Map<string, HTMLButtonElement> = new Map();

  // Overlay elements
  private toolTipBanner: HTMLElement;
  private toolTipText: HTMLElement;
  private measureOverlay: HTMLElement;
  private measureTitle: HTMLElement;
  private measureValue: HTMLElement;
  private btnCloseMeasure: HTMLButtonElement;

  // Status elements
  private statusCoords: HTMLElement;
  private statusZoom: HTMLElement;
  private statusEntities: HTMLElement;
  private statusUnit: HTMLElement;
  private statusScale: HTMLElement;

  // Mobile / Sidebar elements
  private btnToggleSidebar: HTMLButtonElement | null;
  private sidebarBackdrop: HTMLElement | null;
  private rightSidebar: HTMLElement | null;

  // Sidebar elements
  private tabLayers: HTMLElement;
  private tabInspector: HTMLElement;
  private panelLayers: HTMLElement;
  private panelInspector: HTMLElement;
  private layerList: HTMLElement;
  private layerCount: HTMLElement;

  // Inspector elements
  private inspectorEmpty: HTMLElement;
  private inspectorContent: HTMLElement;
  private propType: HTMLElement;
  private propLayer: HTMLElement;
  private propColor: HTMLElement;
  private fieldEditableText: HTMLElement;
  private inputPropText: HTMLInputElement;
  private btnApplyTextProp: HTMLButtonElement;
  private fieldGeometryInfo: HTMLElement;

  constructor() {
    this.canvasEl = document.getElementById('cadCanvas') as HTMLCanvasElement;
    this.fileInputEl = document.getElementById('fileInput') as HTMLInputElement;
    this.btnLoadSample = document.getElementById('btnLoadSample') as HTMLButtonElement;
    this.btnExport = document.getElementById('btnExport') as HTMLButtonElement;
    this.btnFitView = document.getElementById('btnFitView') as HTMLButtonElement;
    this.btnToggleBg = document.getElementById('btnToggleBg') as HTMLButtonElement;
    this.btnDeleteSelected = document.getElementById('btnDeleteSelected') as HTMLButtonElement;

    this.toolTipBanner = document.getElementById('toolTipBanner')!;
    this.toolTipText = document.getElementById('toolTipText')!;
    this.measureOverlay = document.getElementById('measureOverlay')!;
    this.measureTitle = document.getElementById('measureTitle')!;
    this.measureValue = document.getElementById('measureValue')!;
    this.btnCloseMeasure = document.getElementById('btnCloseMeasure') as HTMLButtonElement;

    this.statusCoords = document.getElementById('statusCoords')!;
    this.statusZoom = document.getElementById('statusZoom')!;
    this.statusEntities = document.getElementById('statusEntities')!;
    this.statusUnit = document.getElementById('statusUnit')!;
    this.statusScale = document.getElementById('statusScale')!;

    this.btnToggleSidebar = document.getElementById('btnToggleSidebar') as HTMLButtonElement;
    this.sidebarBackdrop = document.getElementById('sidebarBackdrop');
    this.rightSidebar = document.getElementById('rightSidebar');

    this.tabLayers = document.getElementById('tabLayers')!;
    this.tabInspector = document.getElementById('tabInspector')!;
    this.panelLayers = document.getElementById('panelLayers')!;
    this.panelInspector = document.getElementById('panelInspector')!;
    this.layerList = document.getElementById('layerList')!;
    this.layerCount = document.getElementById('layerCount')!;

    this.inspectorEmpty = document.getElementById('inspectorEmpty')!;
    this.inspectorContent = document.getElementById('inspectorContent')!;
    this.propType = document.getElementById('propType')!;
    this.propLayer = document.getElementById('propLayer')!;
    this.propColor = document.getElementById('propColor')!;
    this.fieldEditableText = document.getElementById('fieldEditableText')!;
    this.inputPropText = document.getElementById('inputPropText') as HTMLInputElement;
    this.btnApplyTextProp = document.getElementById('btnApplyTextProp') as HTMLButtonElement;
    this.fieldGeometryInfo = document.getElementById('fieldGeometryInfo')!;

    // Init core engine modules
    this.renderer = new CADRenderer(this.canvasEl);
    this.history = new HistoryManager();
    this.editor = new EditorTool(this.renderer, this.history);
    this.measure = new MeasureManager(this.renderer);

    this.bindToolButtons();
    this.bindEvents();
    this.bindCanvasMouseEvents();
    this.bindTouchEvents();
    this.bindMobileSidebarEvents();

    // Load initial sample drawing
    this.loadSample();
  }

  private bindToolButtons() {
    const tools: [string, ToolMode | 'measure_len' | 'measure_ar' | 'calib'][] = [
      ['toolPan', 'pan'],
      ['toolMeasureLength', 'measure_len'],
      ['toolMeasureArea', 'measure_ar'],
      ['toolCalibrate', 'calib'],
      ['toolDrawLine', 'draw_line'],
      ['toolDrawRect', 'draw_rect'],
      ['toolDrawCircle', 'draw_circle'],
      ['toolDrawText', 'draw_text'],
      ['toolMove', 'move']
    ];

    tools.forEach(([id, mode]) => {
      const btn = document.getElementById(id) as HTMLButtonElement;
      if (btn) {
        this.toolButtons.set(id, btn);
        btn.addEventListener('click', () => this.switchTool(id, mode));
      }
    });
  }

  private switchTool(btnId: string, mode: ToolMode | 'measure_len' | 'measure_ar' | 'calib') {
    // Clear active button styling
    this.toolButtons.forEach(btn => {
      btn.classList.remove('bg-indigo-600', 'text-white', 'active');
      btn.classList.add('text-slate-400');
    });

    const activeBtn = this.toolButtons.get(btnId);
    if (activeBtn) {
      activeBtn.classList.remove('text-slate-400');
      activeBtn.classList.add('bg-indigo-600', 'text-white', 'active');
    }

    if (mode === 'measure_len') {
      this.editor.setMode('select');
      this.measure.setMode('length');
      this.setBannerText('長度量測模式：依次點擊圖面頂點，雙擊或右鍵結束');
      this.measureOverlay.classList.remove('hidden');
      this.measureTitle.innerText = '長度量測';
    } else if (mode === 'measure_ar') {
      this.editor.setMode('select');
      this.measure.setMode('area');
      this.setBannerText('面積量測模式：點擊多個頂點形成封閉區域，雙擊或右鍵結束');
      this.measureOverlay.classList.remove('hidden');
      this.measureTitle.innerText = '面積量測';
    } else if (mode === 'calib') {
      this.editor.setMode('select');
      this.measure.setMode('calibrate');
      this.setBannerText('比例尺校準：點擊圖面上已知距離的兩個基準點');
    } else {
      this.measure.setMode('none');
      this.measureOverlay.classList.add('hidden');
      this.editor.setMode(mode as ToolMode);

      const tips: Record<string, string> = {
        pan: '模式：平移 / 檢視（拖曳滑鼠平移，滾輪縮放）',
        draw_line: '模式：繪製直線（點擊起點與終點）',
        draw_rect: '模式：繪製矩形（點擊對角兩點）',
        draw_circle: '模式：繪製圓形（點擊圓心與圓週點）',
        draw_text: '模式：新增文字標籤（點擊放置位置）',
        move: '模式：移動物件（選擇物件後，點擊基準點與目標點）'
      };
      this.setBannerText(tips[mode] || '模式：選擇物件');
    }
  }

  private setBannerText(text: string) {
    this.toolTipText.innerText = text;
  }

  private bindEvents() {
    window.addEventListener('resize', () => {
      this.renderer.resizeCanvas();
      this.updateStatus();
    });

    // File Input Loader
    this.fileInputEl.addEventListener('change', async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        try {
          this.setBannerText(`正在解析 ${file.name}...`);
          const doc = await parseCadFile(file);
          this.renderer.setDocument(doc);
          this.refreshLayerPanel();
          this.updateStatus();
          this.setBannerText(`成功載入檔案：${file.name}`);
        } catch (err: any) {
          alert(`載入失敗: ${err.message || err}`);
          this.setBannerText('檔案載入失敗');
        }
      }
    });

    // Sample Loader
    this.btnLoadSample.addEventListener('click', () => this.loadSample());

    // Export DXF
    this.btnExport.addEventListener('click', () => {
      const doc = this.renderer.getDocument();
      if (doc) {
        downloadDxfFile(doc);
      }
    });

    // Fit View
    this.btnFitView.addEventListener('click', () => {
      this.renderer.fitView();
      this.updateStatus();
    });

    // Toggle BG Color Theme
    this.btnToggleBg.addEventListener('click', () => {
      this.renderer.toggleTheme();
    });

    // Delete Selected
    this.btnDeleteSelected.addEventListener('click', () => {
      this.editor.deleteSelected();
      this.updateStatus();
    });

    // Measure Close
    this.btnCloseMeasure.addEventListener('click', () => {
      this.measure.finishMeasurement();
      this.measureOverlay.classList.add('hidden');
      this.switchTool('toolPan', 'pan');
    });

    // Sidebar Tabs
    this.tabLayers.addEventListener('click', () => {
      this.tabLayers.classList.add('border-indigo-500', 'text-indigo-400', 'font-semibold', 'bg-slate-800/50');
      this.tabLayers.classList.remove('border-transparent', 'text-slate-400');
      this.tabInspector.classList.remove('border-indigo-500', 'text-indigo-400', 'font-semibold', 'bg-slate-800/50');
      this.tabInspector.classList.add('border-transparent', 'text-slate-400');
      this.panelLayers.classList.remove('hidden');
      this.panelInspector.classList.add('hidden');
    });

    this.tabInspector.addEventListener('click', () => {
      this.tabInspector.classList.add('border-indigo-500', 'text-indigo-400', 'font-semibold', 'bg-slate-800/50');
      this.tabInspector.classList.remove('border-transparent', 'text-slate-400');
      this.tabLayers.classList.remove('border-indigo-500', 'text-indigo-400', 'font-semibold', 'bg-slate-800/50');
      this.tabLayers.classList.add('border-transparent', 'text-slate-400');
      this.panelInspector.classList.remove('hidden');
      this.panelLayers.classList.add('hidden');
    });

    // Selection Callbacks
    this.editor.onSelectionChange = (selected) => {
      this.updateInspector(selected);
    };

    // Text Prompt Callback for Draw Text
    this.editor.onTextPromptRequest = (callback) => {
      const text = prompt('請輸入要新增的標籤文字：', '新標籤');
      if (text) callback(text);
    };

    // Measurement Callbacks
    this.measure.onMeasurementUpdate = (result) => {
      this.measureValue.innerText = result.formatted;
    };

    this.measure.onCalibrateRequest = (pixelDistWorld) => {
      const scaleInput = prompt(
        `請輸入這一段距離的實際長度（單位：mm）：`,
        `${pixelDistWorld.toFixed(0)}`
      );
      if (scaleInput) {
        const actualValue = parseFloat(scaleInput);
        if (!isNaN(actualValue) && actualValue > 0) {
          const doc = this.renderer.getDocument();
          if (doc) {
            doc.unitScale = actualValue / pixelDistWorld;
            this.updateStatus();
            alert(`校準成功！目前比例尺 1 Drawing Unit = ${doc.unitScale.toFixed(3)} mm`);
          }
        }
      }
    };

    // Apply Text Update in Inspector
    this.btnApplyTextProp.addEventListener('click', () => {
      const newText = this.inputPropText.value;
      this.editor.updateSelectedProperty({ text: newText });
    });
  }

  private bindMobileSidebarEvents() {
    if (this.btnToggleSidebar && this.rightSidebar && this.sidebarBackdrop) {
      const openSidebar = () => {
        this.rightSidebar?.classList.remove('translate-x-full');
        this.sidebarBackdrop?.classList.remove('hidden');
      };

      const closeSidebar = () => {
        this.rightSidebar?.classList.add('translate-x-full');
        this.sidebarBackdrop?.classList.add('hidden');
      };

      this.btnToggleSidebar.addEventListener('click', () => {
        if (this.rightSidebar?.classList.contains('translate-x-full')) {
          openSidebar();
        } else {
          closeSidebar();
        }
      });

      this.sidebarBackdrop.addEventListener('click', closeSidebar);
    }
  }

  private bindTouchEvents() {
    let initialPinchDistance: number | null = null;
    let initialZoom = 1;
    let lastTouchCenter: { x: number; y: number } | null = null;

    const getTouchCenterAndDistance = (touches: TouchList) => {
      const rect = this.canvasEl.getBoundingClientRect();
      if (touches.length === 1) {
        return {
          center: { x: touches[0].clientX - rect.left, y: touches[0].clientY - rect.top },
          distance: 0
        };
      } else if (touches.length >= 2) {
        const t1 = touches[0];
        const t2 = touches[1];
        const p1 = { x: t1.clientX - rect.left, y: t1.clientY - rect.top };
        const p2 = { x: t2.clientX - rect.left, y: t2.clientY - rect.top };
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        return {
          center: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 },
          distance: Math.hypot(dx, dy)
        };
      }
      return null;
    };

    this.canvasEl.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        const rect = this.canvasEl.getBoundingClientRect();
        const screenPt = { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
        lastTouchCenter = screenPt;
        if (this.measure.mode !== 'none') {
          const worldPt = this.renderer.screenToWorld(screenPt);
          this.measure.handlePointClick(worldPt);
        } else {
          this.editor.handleMouseDown(screenPt, 0);
        }
        this.updateStatus(screenPt);
      } else if (e.touches.length >= 2) {
        const touchData = getTouchCenterAndDistance(e.touches);
        if (touchData) {
          initialPinchDistance = touchData.distance;
          initialZoom = this.renderer.zoom;
          lastTouchCenter = touchData.center;
        }
      }
    }, { passive: true });

    this.canvasEl.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1 && lastTouchCenter) {
        const rect = this.canvasEl.getBoundingClientRect();
        const screenPt = { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
        const dx = screenPt.x - lastTouchCenter.x;
        const dy = screenPt.y - lastTouchCenter.y;
        lastTouchCenter = screenPt;

        if (this.measure.mode !== 'none') {
          const worldPt = this.renderer.screenToWorld(screenPt);
          this.measure.handleMouseMove(worldPt);
        } else if (this.editor.activeMode === 'pan') {
          this.renderer.panX += dx;
          this.renderer.panY -= dy;
          this.renderer.requestRender();
        } else {
          this.editor.handleMouseMove(screenPt, true);
        }
        this.updateStatus(screenPt);
      } else if (e.touches.length >= 2 && initialPinchDistance && lastTouchCenter) {
        const touchData = getTouchCenterAndDistance(e.touches);
        if (touchData && touchData.distance > 0) {
          const scaleFactor = touchData.distance / initialPinchDistance;
          const worldBefore = this.renderer.screenToWorld(touchData.center);

          this.renderer.zoom = Math.max(0.001, initialZoom * scaleFactor);

          this.renderer.panX = touchData.center.x - worldBefore.x * this.renderer.zoom;
          this.renderer.panY = (this.canvasEl.height - touchData.center.y) - worldBefore.y * this.renderer.zoom;

          this.renderer.requestRender();
          this.updateStatus(touchData.center);
        }
      }
    }, { passive: true });

    this.canvasEl.addEventListener('touchend', (e) => {
      if (e.touches.length === 0) {
        if (lastTouchCenter) {
          this.editor.handleMouseUp(lastTouchCenter);
        }
        initialPinchDistance = null;
        lastTouchCenter = null;
      } else if (e.touches.length === 1) {
        const rect = this.canvasEl.getBoundingClientRect();
        lastTouchCenter = { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
        initialPinchDistance = null;
      }
    }, { passive: true });
  }

  private loadSample() {
    const doc = createSampleDocument();
    this.renderer.setDocument(doc);
    this.refreshLayerPanel();
    this.updateStatus();
    this.setBannerText('已載入預設範例平面圖，可自由量測或編輯');
  }

  private bindCanvasMouseEvents() {
    let isDragging = false;

    this.canvasEl.addEventListener('mousedown', (e) => {
      const rect = this.canvasEl.getBoundingClientRect();
      const screenPt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      isDragging = false;

      if (e.button === 2) { // Right click finish measure
        if (this.measure.mode !== 'none') {
          this.measure.finishMeasurement();
          this.switchTool('toolPan', 'pan');
          return;
        }
      }

      if (this.measure.mode !== 'none') {
        const worldPt = this.renderer.screenToWorld(screenPt);
        this.measure.handlePointClick(worldPt);
      } else {
        this.editor.handleMouseDown(screenPt, e.button);
      }
      this.updateStatus(screenPt);
    });

    this.canvasEl.addEventListener('mousemove', (e) => {
      const rect = this.canvasEl.getBoundingClientRect();
      const screenPt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      isDragging = true;
      const worldPt = this.renderer.screenToWorld(screenPt);

      if (this.measure.mode !== 'none') {
        this.measure.handleMouseMove(worldPt);
      } else {
        this.editor.handleMouseMove(screenPt, isDragging);
      }
      this.updateStatus(screenPt);
    });

    this.canvasEl.addEventListener('mouseup', (e) => {
      const rect = this.canvasEl.getBoundingClientRect();
      const screenPt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      this.editor.handleMouseUp(screenPt);
    });

    this.canvasEl.addEventListener('contextmenu', (e) => e.preventDefault());

    // Mouse Wheel Zooming
    this.canvasEl.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this.canvasEl.getBoundingClientRect();
      const screenPt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const worldBefore = this.renderer.screenToWorld(screenPt);

      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
      this.renderer.zoom *= zoomFactor;

      // Adjust panX/panY so cursor stays at fixed world point
      this.renderer.panX = screenPt.x - worldBefore.x * this.renderer.zoom;
      this.renderer.panY = (this.canvasEl.height - screenPt.y) - worldBefore.y * this.renderer.zoom;

      this.renderer.requestRender();
      this.updateStatus(screenPt);
    }, { passive: false });
  }

  private refreshLayerPanel() {
    const doc = this.renderer.getDocument();
    if (!doc) return;

    this.layerList.innerHTML = '';
    this.layerCount.innerText = `${doc.layers.size} 個`;

    doc.layers.forEach((layer) => {
      const item = document.createElement('div');
      item.className = 'flex items-center justify-between bg-slate-800/80 hover:bg-slate-800 px-2.5 py-1.5 rounded border border-slate-700/60';

      item.innerHTML = `
        <div class="flex items-center space-x-2">
          <input type="checkbox" ${layer.visible ? 'checked' : ''} class="rounded bg-slate-900 border-slate-700 text-indigo-600 focus:ring-0 cursor-pointer" />
          <span class="w-3 h-3 rounded-full border border-slate-600 shrink-0" style="background-color: ${layer.color}"></span>
          <span class="truncate max-w-[120px] font-mono">${layer.name}</span>
        </div>
      `;

      const checkbox = item.querySelector('input') as HTMLInputElement;
      checkbox.addEventListener('change', () => {
        layer.visible = checkbox.checked;
        this.renderer.requestRender();
      });

      this.layerList.appendChild(item);
    });
  }

  private updateInspector(selectedEntities: CADEntity[]) {
    if (selectedEntities.length === 0) {
      this.inspectorEmpty.classList.remove('hidden');
      this.inspectorContent.classList.add('hidden');
      return;
    }

    this.inspectorEmpty.classList.add('hidden');
    this.inspectorContent.classList.remove('hidden');

    const first = selectedEntities[0];
    this.propType.innerText = first.type;
    this.propLayer.innerText = first.layer;
    this.propColor.innerText = first.color || 'BYLAYER';

    if (first.type === 'TEXT' || first.type === 'MTEXT') {
      this.fieldEditableText.classList.remove('hidden');
      this.inputPropText.value = first.text;
    } else {
      this.fieldEditableText.classList.add('hidden');
    }

    // Geometry Info Details
    let geoHtml = '';
    if (first.type === 'LINE') {
      const len = Math.hypot(first.end.x - first.start.x, first.end.y - first.start.y);
      const scale = this.renderer.getDocument()?.unitScale || 1.0;
      geoHtml = `
        <div>起點: (${first.start.x.toFixed(1)}, ${first.start.y.toFixed(1)})</div>
        <div>終點: (${first.end.x.toFixed(1)}, ${first.end.y.toFixed(1)})</div>
        <div>長度: <span class="text-emerald-400 font-bold">${(len * scale).toFixed(1)} mm</span></div>
      `;
    } else if (first.type === 'CIRCLE') {
      const scale = this.renderer.getDocument()?.unitScale || 1.0;
      geoHtml = `
        <div>圓心: (${first.center.x.toFixed(1)}, ${first.center.y.toFixed(1)})</div>
        <div>半徑: <span class="text-emerald-400 font-bold">${(first.radius * scale).toFixed(1)} mm</span></div>
      `;
    } else if (first.type === 'LWPOLYLINE' || first.type === 'POLYLINE') {
      geoHtml = `<div>頂點數: ${first.vertices?.length || 0}</div>`;
    }

    this.fieldGeometryInfo.innerHTML = geoHtml;
  }

  private updateStatus(screenPt?: Point2D) {
    if (screenPt) {
      const worldPt = this.renderer.screenToWorld(screenPt);
      this.statusCoords.innerText = `${worldPt.x.toFixed(2)}, ${worldPt.y.toFixed(2)}`;
    }

    const doc = this.renderer.getDocument();
    if (doc) {
      this.statusEntities.innerText = `${doc.entities.length}`;
      this.statusScale.innerText = doc.unitScale.toFixed(2);
    }

    this.statusZoom.innerText = `${Math.round(this.renderer.zoom * 100)}%`;
  }
}

// Instantiate App
window.addEventListener('DOMContentLoaded', () => {
  new AppUI();
});
