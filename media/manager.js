
    (function() {
      var vscode = acquireVsCodeApi();
      var docUrls = window.DOC_URLS || {};
      var fileLists = window.FILE_LISTS || { rules: [], skills: [], subagents: [], commands: [] };
      var hooksData = window.HOOKS_DATA || { configFile: 'hooks.json', scripts: [], enabledScripts: [] };
      function init() {
        var placeholder = document.getElementById('main-placeholder');
        var editorWrap = document.getElementById('editor-wrap');
        var editorContainer = document.getElementById('editor-container');
        var editBtn = document.getElementById('edit-btn');
        var editStatus = document.getElementById('edit-status');
        var ruleControls = document.getElementById('rule-controls');
        var ruleTypeSelect = document.getElementById('rule-type');
        var ruleExtraInput = document.getElementById('rule-extra-input');
        var ruleInputWrap = document.getElementById('rule-input-wrap');
        var saveBtn = document.getElementById('save-btn');
        if (!editBtn) return;
        var currentFile = null;
        var editor = null;
        var monacoLoaded = false;
        var MONACO_CDN = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.44.0/min';
        var isRuleEditor = false;
        var ruleBody = '';

        function updateRuleTypeUI() {
          var v = ruleTypeSelect ? ruleTypeSelect.value : 'manual';
          var show = v === 'intelligent' || v === 'files';
          if (ruleInputWrap) ruleInputWrap.classList.toggle('visible', show);
          if (ruleExtraInput) {
            ruleExtraInput.placeholder = v === 'intelligent' ? 'Describe when this rule is relevant' : v === 'files' ? 'e.g. src/**/*.ts or **/*.ts' : '';
          }
        }
        function updateRulePreview() {
          if (!editor || !isRuleEditor) return;
          var fm = buildRuleFrontmatter();
          var v = ruleTypeSelect ? ruleTypeSelect.value : 'manual';
          var yaml = frontmatterToYaml(fm, v);
          var nl = String.fromCharCode(10);
          var full = '---' + nl + yaml + nl + '---' + nl + nl + ruleBody;
          editor.setValue(full);
        }
        function buildRuleFrontmatter() {
          var v = ruleTypeSelect ? ruleTypeSelect.value : 'manual';
          var extra = (ruleExtraInput && ruleExtraInput.value) ? ruleExtraInput.value.trim() : '';
          var alwaysApply = v === 'always';
          if (v === 'intelligent') return { description: extra, alwaysApply: false, globs: '' };
          if (v === 'files') return { description: '', alwaysApply: false, globs: extra };
          return { description: '', alwaysApply: alwaysApply, globs: '' };
        }
        function frontmatterToYaml(fm, ruleType) {
          var lines = [];
          lines.push('alwaysApply: ' + (fm.alwaysApply === true ? 'true' : 'false'));
          if (ruleType === 'intelligent') {
            var desc = fm.description != null ? String(fm.description) : '';
            lines.push('description: ' + (desc ? '"' + desc.replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"') + '"' : '""'));
          }
          if (ruleType === 'files') {
            lines.push('globs: ' + (fm.globs || ''));
          }
          var nl = String.fromCharCode(10);
          return lines.join(nl);
        }
        if (ruleTypeSelect) ruleTypeSelect.addEventListener('change', function() { updateRuleTypeUI(); updateRulePreview(); });
        if (ruleExtraInput) ruleExtraInput.addEventListener('input', updateRulePreview);
        if (ruleExtraInput) ruleExtraInput.addEventListener('change', updateRulePreview);
        function doSave() {
          if (!currentFile || !editor || !isRuleEditor) return;
          var fm = buildRuleFrontmatter();
          var v = ruleTypeSelect ? ruleTypeSelect.value : 'manual';
          var yaml = frontmatterToYaml(fm, v);
          var nl = String.fromCharCode(10);
          var full = '---' + nl + yaml + nl + '---' + nl + nl + ruleBody;
          if (editStatus) editStatus.textContent = 'Saving...';
          vscode.postMessage({ type: 'saveFile', category: currentFile.category, fileName: currentFile.fileName, content: full });
        }
        if (saveBtn) saveBtn.addEventListener('click', function(e) { e.preventDefault(); doSave(); });
        if (ruleControls) ruleControls.addEventListener('click', function(e) {
          if (e.target && (e.target.id === 'save-btn' || (e.target.closest && e.target.closest('#save-btn')))) { e.preventDefault(); doSave(); }
        });

        function renderCategoryList(cat, files) {
          var list = document.getElementById(cat + '-list');
          if (!list) return;
          list.innerHTML = '';
          var createLi = document.createElement('li');
          createLi.className = 'create-new';
          createLi.textContent = '+ Create new';
          createLi.setAttribute('data-create', cat);
          createLi.addEventListener('click', function(e) { e.stopPropagation(); vscode.postMessage({ type: 'createNewFile', category: cat }); });
          list.appendChild(createLi);
          if (cat === 'skills') {
            var seen = {};
            (files || []).forEach(function(entry) {
              var folderName = entry.indexOf('/') >= 0 ? entry.split('/')[0] : entry;
              if (seen[folderName]) return;
              seen[folderName] = true;
              var folderDiv = document.createElement('div');
              folderDiv.className = 'sidebar-skill-folder';
              folderDiv.setAttribute('data-folder', folderName);
              var header = document.createElement('div');
              header.className = 'sidebar-folder-header';
              var chevron = document.createElement('span');
              chevron.className = 'sidebar-folder-chevron sidebar-folder-chevron-hollow';
              chevron.setAttribute('aria-hidden', 'true');
              chevron.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6 4l4 4-4 4"/></svg>';
              var nameSpan = document.createElement('span');
              nameSpan.className = 'sidebar-folder-name';
              nameSpan.textContent = folderName;
              nameSpan.title = folderName;
              var syncBtn = document.createElement('button');
              syncBtn.className = 'sidebar-sync-btn';
              syncBtn.title = 'Sync to Workspace';
              syncBtn.setAttribute('aria-label', 'Sync to Workspace');
              syncBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M7.14645 0.646447C7.34171 0.451184 7.65829 0.451184 7.85355 0.646447L9.35355 2.14645C9.54882 2.34171 9.54882 2.65829 9.35355 2.85355L7.85355 4.35355C7.65829 4.54882 7.34171 4.54882 7.14645 4.35355C6.95118 4.15829 6.95118 3.84171 7.14645 3.64645L7.7885 3.00439C5.12517 3.11522 3 5.30943 3 8C3 9.56799 3.72118 10.9672 4.85185 11.8847C5.06627 12.0587 5.09904 12.3736 4.92503 12.588C4.75103 12.8024 4.43615 12.8352 4.22172 12.6612C2.86712 11.5619 2 9.88205 2 8C2 4.75447 4.57689 2.1108 7.79629 2.00339L7.14645 1.35355C6.95118 1.15829 6.95118 0.841709 7.14645 0.646447ZM11.075 3.41199C11.249 3.19756 11.5639 3.1648 11.7783 3.3388C13.1329 4.43806 14 6.11795 14 8C14 11.2455 11.4231 13.8892 8.20371 13.9966L8.85355 14.6464C9.04882 14.8417 9.04882 15.1583 8.85355 15.3536C8.65829 15.5488 8.34171 15.5488 8.14645 15.3536L6.64645 13.8536C6.55268 13.7598 6.5 13.6326 6.5 13.5C6.5 13.3674 6.55268 13.2402 6.64645 13.1464L8.14645 11.6464C8.34171 11.4512 8.65829 11.4512 8.85355 11.6464C9.04882 11.8417 9.04882 12.1583 8.85355 12.3536L8.2115 12.9956C10.8748 12.8848 13 10.6906 13 8C13 6.43201 12.2788 5.03283 11.1482 4.1153C10.9337 3.94129 10.901 3.62641 11.075 3.41199Z"/></svg>';
              if (!window.WORKSPACE_OPEN) { syncBtn.disabled = true; syncBtn.classList.add('sidebar-sync-btn-disabled'); syncBtn.title = 'Sync to Workspace (open a folder first)'; }
              else { syncBtn.addEventListener('click', function(e) { e.stopPropagation(); e.preventDefault(); vscode.postMessage({ type: 'syncToWorkspace', category: 'skills', fileName: folderName }); }); }
              var editBtn = document.createElement('button');
              editBtn.className = 'sidebar-edit-btn';
              editBtn.title = 'Edit in new window';
              editBtn.setAttribute('aria-label', 'Edit in new window');
              editBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M13.23 1h-1.46L3.52 9.25l-.16.22L1 13.59 2.41 15l4.12-2.36.22-.16L15 4.23V2.77L13.23 1zM2.41 13.59l1.51-3 1.45 1.45-2.96 1.55zm3.83-2.06L4.47 9.76l8-8 1.77 1.77-8 8z"/></svg>';
              editBtn.addEventListener('click', function(e) { e.stopPropagation(); e.preventDefault(); vscode.postMessage({ type: 'openSkillFolderInNewWindow', folderName: folderName }); });
              var exportBtn = document.createElement('button');
              exportBtn.className = 'sidebar-export-btn';
              exportBtn.title = 'Export';
              exportBtn.setAttribute('aria-label', 'Export');
              exportBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M9 1H2v14h9v-2H4V3h4V1H9zm0 2.4L11.6 5H9V3.4zM11 9l2 2v-2h2v-1h-2V7h-1v2H9v1h2z"/></svg>';
              exportBtn.addEventListener('click', function(e) { e.stopPropagation(); e.preventDefault(); vscode.postMessage({ type: 'exportItem', category: 'skills', fileName: folderName }); });
              var delBtn = document.createElement('button');
              delBtn.className = 'sidebar-delete-btn';
              delBtn.title = 'Delete skill';
              delBtn.setAttribute('aria-label', 'Delete');
              delBtn.textContent = '\uD83D\uDDD1';
              delBtn.addEventListener('click', function(e) { e.stopPropagation(); e.preventDefault(); vscode.postMessage({ type: 'deleteFile', category: 'skills', fileName: folderName }); });
              var actionsWrap = document.createElement('span');
              actionsWrap.className = 'sidebar-actions';
              actionsWrap.appendChild(syncBtn);
              actionsWrap.appendChild(editBtn);
              actionsWrap.appendChild(exportBtn);
              actionsWrap.appendChild(delBtn);
              header.appendChild(chevron);
              header.appendChild(nameSpan);
              header.appendChild(actionsWrap);
              var contentsUl = document.createElement('ul');
              contentsUl.className = 'sidebar-folder-contents';
              contentsUl.setAttribute('data-folder', folderName);
              header.addEventListener('click', function(e) {
                if (e.target.closest('.sidebar-actions')) return;
                document.querySelectorAll('.sidebar-readme-link, .sidebar-section-header, .sidebar-folder-header, .sidebar-file-list .file-row, .sidebar-folder-contents li').forEach(function(el) { el.classList.remove('active'); });
                header.classList.add('active');
                folderDiv.classList.toggle('expanded');
                if (folderDiv.classList.contains('expanded') && contentsUl.children.length === 0) {
                  vscode.postMessage({ type: 'getSkillFolderContents', folderName: folderName });
                }
              });
              folderDiv.appendChild(header);
              folderDiv.appendChild(contentsUl);
              var liWrap = document.createElement('li');
              liWrap.className = 'sidebar-skill-folder-li';
              liWrap.style.listStyle = 'none';
              liWrap.appendChild(folderDiv);
              list.appendChild(liWrap);
            });
          } else {
            (files || []).forEach(function(name) {
              var row = document.createElement('li');
              row.className = 'file-row';
              row.setAttribute('data-file', name);
              var nameSpan = document.createElement('span');
              nameSpan.className = 'file-name';
              nameSpan.textContent = name;
              nameSpan.title = name;
              var syncBtn = document.createElement('button');
              syncBtn.className = 'sidebar-sync-btn';
              syncBtn.title = 'Sync to Workspace';
              syncBtn.setAttribute('aria-label', 'Sync to Workspace');
              syncBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M7.14645 0.646447C7.34171 0.451184 7.65829 0.451184 7.85355 0.646447L9.35355 2.14645C9.54882 2.34171 9.54882 2.65829 9.35355 2.85355L7.85355 4.35355C7.65829 4.54882 7.34171 4.54882 7.14645 4.35355C6.95118 4.15829 6.95118 3.84171 7.14645 3.64645L7.7885 3.00439C5.12517 3.11522 3 5.30943 3 8C3 9.56799 3.72118 10.9672 4.85185 11.8847C5.06627 12.0587 5.09904 12.3736 4.92503 12.588C4.75103 12.8024 4.43615 12.8352 4.22172 12.6612C2.86712 11.5619 2 9.88205 2 8C2 4.75447 4.57689 2.1108 7.79629 2.00339L7.14645 1.35355C6.95118 1.15829 6.95118 0.841709 7.14645 0.646447ZM11.075 3.41199C11.249 3.19756 11.5639 3.1648 11.7783 3.3388C13.1329 4.43806 14 6.11795 14 8C14 11.2455 11.4231 13.8892 8.20371 13.9966L8.85355 14.6464C9.04882 14.8417 9.04882 15.1583 8.85355 15.3536C8.65829 15.5488 8.34171 15.5488 8.14645 15.3536L6.64645 13.8536C6.55268 13.7598 6.5 13.6326 6.5 13.5C6.5 13.3674 6.55268 13.2402 6.64645 13.1464L8.14645 11.6464C8.34171 11.4512 8.65829 11.4512 8.85355 11.6464C9.04882 11.8417 9.04882 12.1583 8.85355 12.3536L8.2115 12.9956C10.8748 12.8848 13 10.6906 13 8C13 6.43201 12.2788 5.03283 11.1482 4.1153C10.9337 3.94129 10.901 3.62641 11.075 3.41199Z"/></svg>';
              if (!window.WORKSPACE_OPEN) { syncBtn.disabled = true; syncBtn.classList.add('sidebar-sync-btn-disabled'); syncBtn.title = 'Sync to Workspace (open a folder first)'; }
              else { syncBtn.addEventListener('click', function(e) { e.stopPropagation(); e.preventDefault(); vscode.postMessage({ type: 'syncToWorkspace', category: cat, fileName: name }); }); }
              var exportBtn = document.createElement('button');
              exportBtn.className = 'sidebar-export-btn';
              exportBtn.title = 'Export';
              exportBtn.setAttribute('aria-label', 'Export');
              exportBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M9 1H2v14h9v-2H4V3h4V1H9zm0 2.4L11.6 5H9V3.4zM11 9l2 2v-2h2v-1h-2V7h-1v2H9v1h2z"/></svg>';
              exportBtn.addEventListener('click', function(e) { e.stopPropagation(); e.preventDefault(); vscode.postMessage({ type: 'exportItem', category: cat, fileName: name }); });
              var delBtn = document.createElement('button');
              delBtn.className = 'sidebar-delete-btn';
              delBtn.title = 'Delete';
              delBtn.setAttribute('aria-label', 'Delete');
              delBtn.textContent = '\uD83D\uDDD1';
              delBtn.addEventListener('click', function(e) { e.stopPropagation(); e.preventDefault(); vscode.postMessage({ type: 'deleteFile', category: cat, fileName: name }); });
              var actionsWrap = document.createElement('span');
              actionsWrap.className = 'sidebar-actions';
              actionsWrap.appendChild(syncBtn);
              actionsWrap.appendChild(exportBtn);
              actionsWrap.appendChild(delBtn);
              nameSpan.addEventListener('click', function() {
                document.querySelectorAll('.sidebar-readme-link, .sidebar-section-header, .sidebar-folder-header, .sidebar-file-list .file-row, .sidebar-folder-contents li').forEach(function(el) { el.classList.remove('active'); });
                row.classList.add('active');
                vscode.postMessage({ type: 'getFileContent', category: cat, fileName: name });
              });
              row.appendChild(nameSpan);
              row.appendChild(actionsWrap);
              list.appendChild(row);
            });
          }
        }
        ['rules', 'skills', 'subagents', 'commands'].forEach(function(category) {
          var list = document.getElementById(category + '-list');
          var section = list && list.closest('.sidebar-section');
          if (!list) return;
          if (section) {
            section.querySelector('.sidebar-section-header').addEventListener('click', function(e) {
              if (e.target.closest('.sidebar-section-help') || e.target.closest('.sidebar-section-import')) return;
              document.querySelectorAll('.sidebar-readme-link, .sidebar-section-header, .sidebar-folder-header, .sidebar-file-list .file-row, .sidebar-folder-contents li').forEach(function(el) { el.classList.remove('active'); });
              section.querySelector('.sidebar-section-header').classList.add('active');
              section.classList.toggle('expanded');
              showOverviewContent();
            });
            var importBtn = section.querySelector('.sidebar-section-import');
            if (importBtn) {
              importBtn.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                vscode.postMessage({ type: 'importInCategory', category: category });
              });
            }
            var helpLink = section.querySelector('.sidebar-section-help');
            if (helpLink && docUrls[category]) {
              helpLink.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                vscode.postMessage({ type: 'openLink', url: docUrls[category] });
              });
            }
          }
          renderCategoryList(category, fileLists[category] || []);
        });
        function renderHooksList(hd) {
          if (!hd) hd = hooksData;
          var list = document.getElementById('hooks-list');
          if (!list) return;
          list.innerHTML = '';
          var configFile = hd.configFile || 'hooks.json';
          var row = document.createElement('li');
          row.className = 'file-row';
          row.setAttribute('data-file', configFile);
          var nameSpan = document.createElement('span');
          nameSpan.className = 'file-name';
          nameSpan.textContent = configFile;
          nameSpan.title = configFile;
          var syncBtn = document.createElement('button');
          syncBtn.className = 'sidebar-sync-btn';
          syncBtn.title = 'Sync to Workspace';
          syncBtn.setAttribute('aria-label', 'Sync to Workspace');
          syncBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M7.14645 0.646447C7.34171 0.451184 7.65829 0.451184 7.85355 0.646447L9.35355 2.14645C9.54882 2.34171 9.54882 2.65829 9.35355 2.85355L7.85355 4.35355C7.65829 4.54882 7.34171 4.54882 7.14645 4.35355C6.95118 4.15829 6.95118 3.84171 7.14645 3.64645L7.7885 3.00439C5.12517 3.11522 3 5.30943 3 8C3 9.56799 3.72118 10.9672 4.85185 11.8847C5.06627 12.0587 5.09904 12.3736 4.92503 12.588C4.75103 12.8024 4.43615 12.8352 4.22172 12.6612C2.86712 11.5619 2 9.88205 2 8C2 4.75447 4.57689 2.1108 7.79629 2.00339L7.14645 1.35355C6.95118 1.15829 6.95118 0.841709 7.14645 0.646447ZM11.075 3.41199C11.249 3.19756 11.5639 3.1648 11.7783 3.3388C13.1329 4.43806 14 6.11795 14 8C14 11.2455 11.4231 13.8892 8.20371 13.9966L8.85355 14.6464C9.04882 14.8417 9.04882 15.1583 8.85355 15.3536C8.65829 15.5488 8.34171 15.5488 8.14645 15.3536L6.64645 13.8536C6.55268 13.7598 6.5 13.6326 6.5 13.5C6.5 13.3674 6.55268 13.2402 6.64645 13.1464L8.14645 11.6464C8.34171 11.4512 8.65829 11.4512 8.85355 11.6464C9.04882 11.8417 9.04882 12.1583 8.85355 12.3536L8.2115 12.9956C10.8748 12.8848 13 10.6906 13 8C13 6.43201 12.2788 5.03283 11.1482 4.1153C10.9337 3.94129 10.901 3.62641 11.075 3.41199Z"/></svg>';
          if (!window.WORKSPACE_OPEN) { syncBtn.disabled = true; syncBtn.classList.add('sidebar-sync-btn-disabled'); syncBtn.title = 'Sync to Workspace (open a folder first)'; } else { syncBtn.addEventListener('click', function(e) { e.stopPropagation(); e.preventDefault(); vscode.postMessage({ type: 'syncToWorkspace', category: 'hooks', fileName: configFile }); }); }
          var exportBtn = document.createElement('button');
          exportBtn.className = 'sidebar-export-btn';
          exportBtn.title = 'Export';
          exportBtn.setAttribute('aria-label', 'Export');
          exportBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M9 1H2v14h9v-2H4V3h4V1H9zm0 2.4L11.6 5H9V3.4zM11 9l2 2v-2h2v-1h-2V7h-1v2H9v1h2z"/></svg>';
          exportBtn.addEventListener('click', function(e) { e.stopPropagation(); e.preventDefault(); vscode.postMessage({ type: 'exportItem', category: 'hooks', fileName: configFile }); });
          var delBtn = document.createElement('button');
          delBtn.className = 'sidebar-delete-btn';
          delBtn.title = 'Clear hooks (empty config)';
          delBtn.setAttribute('aria-label', 'Clear');
          delBtn.textContent = '\uD83D\uDDD1';
          delBtn.addEventListener('click', function(e) { e.stopPropagation(); e.preventDefault(); vscode.postMessage({ type: 'deleteFile', category: 'hooks', fileName: configFile }); });
          var actionsWrap = document.createElement('span');
          actionsWrap.className = 'sidebar-actions';
          actionsWrap.appendChild(syncBtn);
          actionsWrap.appendChild(exportBtn);
          actionsWrap.appendChild(delBtn);
          nameSpan.addEventListener('click', function() {
            document.querySelectorAll('.sidebar-readme-link, .sidebar-section-header, .sidebar-folder-header, .sidebar-file-list .file-row, .sidebar-folder-contents li').forEach(function(el) { el.classList.remove('active'); });
            row.classList.add('active');
            vscode.postMessage({ type: 'getFileContent', category: 'hooks', fileName: configFile });
          });
          row.appendChild(nameSpan);
          row.appendChild(actionsWrap);
          list.appendChild(row);
          var folderDiv = document.createElement('div');
          folderDiv.className = 'sidebar-skill-folder';
          folderDiv.setAttribute('data-folder', 'hooks');
          var header = document.createElement('div');
          header.className = 'sidebar-folder-header';
          var chevron = document.createElement('span');
          chevron.className = 'sidebar-folder-chevron sidebar-folder-chevron-hollow';
          chevron.setAttribute('aria-hidden', 'true');
          chevron.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6 4l4 4-4 4"/></svg>';
          var nameSpan2 = document.createElement('span');
          nameSpan2.className = 'sidebar-folder-name';
          nameSpan2.textContent = 'hooks';
          nameSpan2.title = 'hooks';
          header.appendChild(chevron);
          header.appendChild(nameSpan2);
          var contentsUl = document.createElement('ul');
          contentsUl.className = 'sidebar-folder-contents';
          contentsUl.setAttribute('data-folder', 'hooks');
          var createLi = document.createElement('li');
          createLi.className = 'create-new';
          createLi.textContent = '+ Create new';
          createLi.setAttribute('data-create-hook', '1');
          createLi.addEventListener('click', function(ev) { ev.stopPropagation(); vscode.postMessage({ type: 'createNewHook' }); });
          contentsUl.appendChild(createLi);
          var spawnLi = document.createElement('li');
          spawnLi.className = 'create-new';
          spawnLi.textContent = 'Spawn placeholders';
          spawnLi.title = 'Create absent hook files as placeholder';
          spawnLi.setAttribute('data-spawn-hook-placeholders', '1');
          spawnLi.addEventListener('click', function(ev) { ev.stopPropagation(); vscode.postMessage({ type: 'spawnHookPlaceholders' }); });
          contentsUl.appendChild(spawnLi);
          (hd.scripts || []).forEach(function(scriptName) {
            var li = document.createElement('li');
            li.className = 'sidebar-hook-script-row';
            li.setAttribute('data-script', scriptName);
            var enabled = (hd.enabledScripts || []).indexOf(scriptName) >= 0;
            var cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = enabled;
            cb.className = 'sidebar-hook-checkbox';
            cb.addEventListener('change', function() { vscode.postMessage({ type: 'setHookEnabled', scriptName: scriptName, enabled: cb.checked }); });
            var label = document.createElement('span');
            label.className = 'sidebar-hook-script-name';
            label.textContent = scriptName;
            label.title = scriptName;
            var syncBtn2 = document.createElement('button');
            syncBtn2.className = 'sidebar-sync-btn';
            syncBtn2.title = 'Sync to Workspace';
            syncBtn2.setAttribute('aria-label', 'Sync to Workspace');
            syncBtn2.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M7.14645 0.646447C7.34171 0.451184 7.65829 0.451184 7.85355 0.646447L9.35355 2.14645C9.54882 2.34171 9.54882 2.65829 9.35355 2.85355L7.85355 4.35355C7.65829 4.54882 7.34171 4.54882 7.14645 4.35355C6.95118 4.15829 6.95118 3.84171 7.14645 3.64645L7.7885 3.00439C5.12517 3.11522 3 5.30943 3 8C3 9.56799 3.72118 10.9672 4.85185 11.8847C5.06627 12.0587 5.09904 12.3736 4.92503 12.588C4.75103 12.8024 4.43615 12.8352 4.22172 12.6612C2.86712 11.5619 2 9.88205 2 8C2 4.75447 4.57689 2.1108 7.79629 2.00339L7.14645 1.35355C6.95118 1.15829 6.95118 0.841709 7.14645 0.646447ZM11.075 3.41199C11.249 3.19756 11.5639 3.1648 11.7783 3.3388C13.1329 4.43806 14 6.11795 14 8C14 11.2455 11.4231 13.8892 8.20371 13.9966L8.85355 14.6464C9.04882 14.8417 9.04882 15.1583 8.85355 15.3536C8.65829 15.5488 8.34171 15.5488 8.14645 15.3536L6.64645 13.8536C6.55268 13.7598 6.5 13.6326 6.5 13.5C6.5 13.3674 6.55268 13.2402 6.64645 13.1464L8.14645 11.6464C8.34171 11.4512 8.65829 11.4512 8.85355 11.6464C9.04882 11.8417 9.04882 12.1583 8.85355 12.3536L8.2115 12.9956C10.8748 12.8848 13 10.6906 13 8C13 6.43201 12.2788 5.03283 11.1482 4.1153C10.9337 3.94129 10.901 3.62641 11.075 3.41199Z"/></svg>';
            if (!window.WORKSPACE_OPEN) { syncBtn2.disabled = true; syncBtn2.classList.add('sidebar-sync-btn-disabled'); } else { syncBtn2.addEventListener('click', function(e) { e.stopPropagation(); e.preventDefault(); vscode.postMessage({ type: 'syncToWorkspace', category: 'hooks', fileName: scriptName }); }); }
            var exportBtn2 = document.createElement('button');
            exportBtn2.className = 'sidebar-export-btn';
            exportBtn2.title = 'Export';
            exportBtn2.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M9 1H2v14h9v-2H4V3h4V1H9zm0 2.4L11.6 5H9V3.4zM11 9l2 2v-2h2v-1h-2V7h-1v2H9v1h2z"/></svg>';
            exportBtn2.addEventListener('click', function(e) { e.stopPropagation(); e.preventDefault(); vscode.postMessage({ type: 'exportItem', category: 'hooks', fileName: scriptName }); });
            var delBtn2 = document.createElement('button');
            delBtn2.className = 'sidebar-delete-btn';
            delBtn2.title = 'Delete';
            delBtn2.textContent = '\uD83D\uDDD1';
            delBtn2.addEventListener('click', function(e) { e.stopPropagation(); e.preventDefault(); vscode.postMessage({ type: 'deleteFile', category: 'hooks', fileName: scriptName }); });
            var actionsWrap2 = document.createElement('span');
            actionsWrap2.className = 'sidebar-actions';
            actionsWrap2.appendChild(syncBtn2);
            actionsWrap2.appendChild(exportBtn2);
            actionsWrap2.appendChild(delBtn2);
            li.appendChild(cb);
            li.appendChild(label);
            li.appendChild(actionsWrap2);
            label.addEventListener('click', function() {
              document.querySelectorAll('.sidebar-readme-link, .sidebar-section-header, .sidebar-folder-header, .sidebar-file-list .file-row, .sidebar-folder-contents li').forEach(function(el) { el.classList.remove('active'); });
              li.classList.add('active');
              vscode.postMessage({ type: 'getFileContent', category: 'hooks', fileName: scriptName });
            });
            contentsUl.appendChild(li);
          });
          header.addEventListener('click', function(e) {
            if (e.target.closest('.sidebar-actions')) return;
            document.querySelectorAll('.sidebar-readme-link, .sidebar-section-header, .sidebar-folder-header, .sidebar-file-list .file-row, .sidebar-folder-contents li').forEach(function(el) { el.classList.remove('active'); });
            header.classList.add('active');
            folderDiv.classList.toggle('expanded');
          });
          folderDiv.appendChild(header);
          folderDiv.appendChild(contentsUl);
          var liWrap = document.createElement('li');
          liWrap.className = 'sidebar-skill-folder-li';
          liWrap.style.listStyle = 'none';
          liWrap.appendChild(folderDiv);
          list.appendChild(liWrap);
        }
        renderHooksList();

        var hooksSection = document.querySelector('.sidebar-section[data-category="hooks"]');
        if (hooksSection) {
          var hooksHeader = hooksSection.querySelector('.sidebar-section-header');
          if (hooksHeader) hooksHeader.addEventListener('click', function(e) {
            if (e.target.closest('.sidebar-section-help') || e.target.closest('.sidebar-section-import')) return;
            document.querySelectorAll('.sidebar-readme-link, .sidebar-section-header, .sidebar-folder-header, .sidebar-file-list .file-row, .sidebar-folder-contents li').forEach(function(el) { el.classList.remove('active'); });
            hooksHeader.classList.add('active');
            hooksSection.classList.toggle('expanded');
            if (hooksSection.classList.contains('expanded')) vscode.postMessage({ type: 'requestHooksData' });
            showHooksLandingContent();
          });
          var importBtn = hooksSection.querySelector('.sidebar-section-import');
          if (importBtn) importBtn.addEventListener('click', function(ev) { ev.preventDefault(); ev.stopPropagation(); vscode.postMessage({ type: 'importInCategory', category: 'hooks' }); });
          var helpLink = hooksSection.querySelector('.sidebar-section-help');
          if (helpLink && docUrls.hooks) helpLink.addEventListener('click', function(ev) { ev.preventDefault(); ev.stopPropagation(); vscode.postMessage({ type: 'openLink', url: docUrls.hooks }); });
        }

        var sidebarReadme = document.getElementById('sidebar-readme');
        if (sidebarReadme) {
          sidebarReadme.addEventListener('click', function() {
            document.querySelectorAll('.sidebar-readme-link, .sidebar-section-header, .sidebar-folder-header, .sidebar-file-list .file-row, .sidebar-folder-contents li').forEach(function(el) { el.classList.remove('active'); });
            sidebarReadme.classList.add('active');
            showOverviewContent();
          });
        }
        document.querySelectorAll('.main-placeholder .readme-links a[data-doc]').forEach(function(a) {
          a.addEventListener('click', function(e) {
            e.preventDefault();
            var key = a.getAttribute('data-doc');
            if (key === 'hooks') {
              var section = document.querySelector('.sidebar-section[data-category="hooks"]');
              if (section) section.classList.add('expanded');
              vscode.postMessage({ type: 'requestHooksData' });
              showHooksLandingContent();
            } else if (docUrls[key]) vscode.postMessage({ type: 'openLink', url: docUrls[key] });
          });
        });

      function showEditor() {
        placeholder.style.display = 'none';
        editorWrap.style.display = 'flex';
        var readmeEl = document.getElementById('sidebar-readme');
        if (readmeEl) readmeEl.classList.remove('active');
        var hooksLanding = document.getElementById('hooks-landing');
        if (hooksLanding) hooksLanding.style.display = 'none';
        var readmeContent = document.getElementById('readme-content');
        if (readmeContent) readmeContent.style.display = 'block';
      }
      function showPlaceholder() {
        placeholder.style.display = 'block';
        editorWrap.style.display = 'none';
      }
      function showOverviewContent() {
        var rc = document.getElementById('readme-content');
        var hl = document.getElementById('hooks-landing');
        if (rc) rc.style.display = 'block';
        if (hl) hl.style.display = 'none';
        showPlaceholder();
      }
      function showHooksLandingContent() {
        var rc = document.getElementById('readme-content');
        var hl = document.getElementById('hooks-landing');
        if (rc) rc.style.display = 'none';
        if (hl) hl.style.display = 'block';
        showPlaceholder();
      }

      var usePlainTextFallback = false;
      var MONACO_RETRIES = 3;
      function loadMonaco(cb) {
        if (monacoLoaded && window.monaco) { cb(); return; }
        if (usePlainTextFallback) { cb(); return; }
        var workerUrl = MONACO_CDN + '/vs/base/worker/workerMain.js';
        function attempt(retryCount) {
          fetch(workerUrl).then(function(r) { if (!r.ok) throw new Error(r.status); return r.text(); }).then(function(workerCode) {
            var blob = new Blob([workerCode], { type: 'application/javascript' });
            var blobUrl = URL.createObjectURL(blob);
            window.MonacoEnvironment = { getWorkerUrl: function() { return blobUrl; } };
            var s = document.createElement('script');
            s.src = MONACO_CDN + '/vs/loader.js';
            s.onload = function() {
              require.config({ paths: { vs: MONACO_CDN + '/vs' } });
              require(['vs/editor/editor.main'], function() {
                monacoLoaded = true;
                window.monaco = monaco;
                cb();
              });
            };
            s.onerror = function() { throw new Error('Loader failed'); };
            document.head.appendChild(s);
          }).catch(function(err) {
            if (retryCount < MONACO_RETRIES - 1) {
              setTimeout(function() { attempt(retryCount + 1); }, 800);
            } else {
              console.warn('Monaco load failed after ' + MONACO_RETRIES + ' attempts, using plain text', err);
              usePlainTextFallback = true;
              if (editStatus) editStatus.textContent = 'Using plain text (Monaco unavailable)';
              cb();
            }
          });
        }
        attempt(0);
      }

      function ensureEditor() {
        if (editor) return;
        if (usePlainTextFallback) {
          var ta = document.createElement('textarea');
          ta.setAttribute('spellcheck', 'false');
          ta.style.cssText = 'width:100%;height:100%;box-sizing:border-box;padding:8px;font-family:var(--vscode-editor-font-family,monospace);font-size:var(--vscode-editor-font-size,14px);border:none;resize:none;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);';
          ta.readOnly = true;
          editorContainer.appendChild(ta);
          editor = { setValue: function(v) { ta.value = v || ''; }, getValue: function() { return ta.value; }, updateOptions: function() {} };
          return;
        }
        var theme = document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast') ? 'vs-dark' : 'vs';
        editor = window.monaco.editor.create(editorContainer, {
          value: '',
          language: 'markdown',
          theme: theme,
          readOnly: true,
          minimap: { enabled: false },
          automaticLayout: true,
          fontSize: parseInt(getComputedStyle(document.body).fontSize) || 14,
          fontFamily: getComputedStyle(document.body).fontFamily || 'monospace'
        });
      }

      editBtn.addEventListener('click', function() {
        if (!currentFile) {
          if (editStatus) editStatus.textContent = 'Open a file first';
          return;
        }
        if (editStatus) editStatus.textContent = 'Opening...';
        vscode.postMessage({ type: 'openInEditor', category: currentFile.category, fileName: currentFile.fileName });
      });

      window.addEventListener('message', function(event) {
        var data = event.data;
        if (data.type === 'refreshLists') {
          var expandedSections = [];
          document.querySelectorAll('.sidebar-section.expanded').forEach(function(el) { expandedSections.push(el.getAttribute('data-category')); });
          var expandedSkillFolders = [];
          document.querySelectorAll('.sidebar-skill-folder.expanded').forEach(function(el) { expandedSkillFolders.push(el.getAttribute('data-folder')); });
          var selectedFile = currentFile ? { category: currentFile.category, fileName: currentFile.fileName } : null;
          if (data.fileLists) fileLists = data.fileLists;
          if (data.hooksData) hooksData = data.hooksData;
          if (typeof data.workspaceOpen === 'boolean') window.WORKSPACE_OPEN = data.workspaceOpen;
          ['rules', 'skills', 'subagents', 'commands'].forEach(function(cat) { renderCategoryList(cat, fileLists[cat] || []); });
          renderHooksList();
          expandedSections.forEach(function(cat) {
            var section = document.querySelector('.sidebar-section[data-category="' + cat + '"]');
            if (section) section.classList.add('expanded');
          });
          expandedSkillFolders.forEach(function(folderName) {
            var folderDiv = document.querySelector('.sidebar-skill-folder[data-folder="' + folderName + '"]');
            if (folderDiv) {
              folderDiv.classList.add('expanded');
              var section = folderDiv.closest('.sidebar-section');
              var isSkillsSection = section && section.getAttribute('data-category') === 'skills';
              var contentsUl = folderDiv.querySelector('.sidebar-folder-contents');
              if (isSkillsSection && contentsUl && contentsUl.children.length === 0) vscode.postMessage({ type: 'getSkillFolderContents', folderName: folderName });
            }
          });
            if (selectedFile) {
            document.querySelectorAll('.sidebar-readme-link, .sidebar-section-header, .sidebar-folder-header, .sidebar-file-list .file-row, .sidebar-folder-contents li').forEach(function(el) { el.classList.remove('active'); });
            if (selectedFile.category !== 'skills' && selectedFile.category !== 'hooks') {
              var row = document.querySelector('.sidebar-section[data-category="' + selectedFile.category + '"] .file-row[data-file="' + selectedFile.fileName + '"]');
              if (row) row.classList.add('active');
            } else if (selectedFile.category === 'hooks') {
              var hooksRow = document.querySelector('.sidebar-section[data-category="hooks"] .file-row[data-file="' + selectedFile.fileName + '"]');
              if (hooksRow) hooksRow.classList.add('active');
              var hooksScriptRow = document.querySelector('.sidebar-section[data-category="hooks"] .sidebar-folder-contents li[data-script="' + selectedFile.fileName + '"]');
              if (hooksScriptRow) hooksScriptRow.classList.add('active');
            }
            vscode.postMessage({ type: 'getFileContent', category: selectedFile.category, fileName: selectedFile.fileName });
          }
          var hooksSec = document.querySelector('.sidebar-section[data-category="hooks"]');
          var hl = document.getElementById('hooks-landing');
          var rc = document.getElementById('readme-content');
          if (hooksSec && hooksSec.classList.contains('expanded') && hl && rc) { rc.style.display = 'none'; hl.style.display = 'block'; } else if (rc && hl) { rc.style.display = 'block'; hl.style.display = 'none'; }
          return;
        }
        if (data.type === 'hooksData' && data.hooksData) {
          hooksData = data.hooksData;
          renderHooksList();
          return;
        }
        if (data.type === 'showFileInPreview' && data.category && data.fileName) {
          currentFile = { category: data.category, fileName: data.fileName };
          document.querySelectorAll('.sidebar-readme-link, .sidebar-section-header, .sidebar-folder-header, .sidebar-file-list .file-row, .sidebar-folder-contents li').forEach(function(el) { el.classList.remove('active'); });
          var section = document.querySelector('.sidebar-section[data-category="' + data.category + '"]');
          if (section) section.classList.add('expanded');
          if (data.category === 'hooks') {
            var hooksLanding = document.getElementById('hooks-landing');
            var readmeContent = document.getElementById('readme-content');
            if (hooksLanding && readmeContent) { readmeContent.style.display = 'none'; hooksLanding.style.display = 'block'; }
            var hooksFolder = document.querySelector('.sidebar-skill-folder[data-folder="hooks"]');
            if (hooksFolder) hooksFolder.classList.add('expanded');
          }
          var row = document.querySelector('.sidebar-section[data-category="' + data.category + '"] .file-row[data-file="' + data.fileName + '"]');
          if (row) row.classList.add('active');
          vscode.postMessage({ type: 'getFileContent', category: data.category, fileName: data.fileName });
          return;
        }
        if (data.type === 'getSkillFolderContentsReply') {
          if (data.error) return;
          var ul = document.querySelector('.sidebar-folder-contents[data-folder="' + data.folderName + '"]');
          if (!ul || ul.children.length > 0) return;
          (data.entries || []).forEach(function(entry) {
            var li = document.createElement('li');
            li.textContent = entry;
            li.title = entry;
            li.setAttribute('data-entry', entry);
            var fullName = data.folderName + '/' + entry;
            if (currentFile && currentFile.category === 'skills' && currentFile.fileName === fullName) {
              document.querySelectorAll('.sidebar-readme-link, .sidebar-section-header, .sidebar-folder-header, .sidebar-file-list .file-row, .sidebar-folder-contents li').forEach(function(el) { el.classList.remove('active'); });
              li.classList.add('active');
            }
            li.addEventListener('click', function() {
              document.querySelectorAll('.sidebar-readme-link, .sidebar-section-header, .sidebar-folder-header, .sidebar-file-list .file-row, .sidebar-folder-contents li').forEach(function(el) { el.classList.remove('active'); });
              li.classList.add('active');
              vscode.postMessage({ type: 'getFileContent', category: 'skills', fileName: fullName });
            });
            ul.appendChild(li);
          });
          return;
        }
        if (data.type === 'deleteFileReply') {
          if (data.error && editStatus) editStatus.textContent = data.error;
          else if (currentFile && data.deletedCategory === currentFile.category && (currentFile.fileName === data.deletedFileName || (data.deletedCategory === 'skills' && currentFile.fileName.indexOf(data.deletedFileName + '/') === 0))) {
            showPlaceholder();
            currentFile = null;
            if (editStatus) editStatus.textContent = '';
          }
          return;
        }
        if (data.type === 'createNewFileReply') {
          if (data.error) {
            if (editStatus) editStatus.textContent = 'Error: ' + data.error;
          } else {
            if (editStatus) editStatus.textContent = 'Created ' + (data.fileName || '');
            if (data.category && data.fileName) {
              var section = document.querySelector('.sidebar-section[data-category="' + data.category + '"]');
              if (section) section.classList.add('expanded');
              vscode.postMessage({ type: 'getFileContent', category: data.category, fileName: data.fileName });
            }
          }
          return;
        }
        if (data.type === 'createNewHookReply') {
          if (data.error) {
            if (editStatus) editStatus.textContent = (data.error === 'Canceled' ? '' : 'Error: ' + data.error);
          } else if (data.scriptName) {
            if (editStatus) editStatus.textContent = 'Created ' + data.scriptName;
            currentFile = { category: 'hooks', fileName: data.scriptName };
            var hooksSection = document.querySelector('.sidebar-section[data-category="hooks"]');
            if (hooksSection) hooksSection.classList.add('expanded');
            var hooksLanding = document.getElementById('hooks-landing');
            var readmeContent = document.getElementById('readme-content');
            if (hooksLanding && readmeContent) { readmeContent.style.display = 'none'; hooksLanding.style.display = 'block'; }
            var hooksFolder = document.querySelector('.sidebar-skill-folder[data-folder="hooks"]');
            if (hooksFolder) hooksFolder.classList.add('expanded');
            vscode.postMessage({ type: 'getFileContent', category: 'hooks', fileName: data.scriptName });
          }
          return;
        }
        if (data.type === 'openInEditorReply') {
          if (editStatus) editStatus.textContent = data.error ? 'Error: ' + data.error : 'Opened';
          return;
        }
        if (data.type === 'saveFileReply') {
          if (editStatus) editStatus.textContent = data.error ? 'Error: ' + data.error : 'Saved';
          return;
        }
        if (data.type === 'syncReply') {
          if (editStatus) editStatus.textContent = data.error ? 'Error: ' + data.error : (data.cancelled ? '' : 'Synced to workspace');
          if (data.error) setTimeout(function() { if (editStatus) editStatus.textContent = ''; }, 4000);
          return;
        }
        if (data.type === 'getFileContentReply') {
          if (data.error) {
            if (editStatus) editStatus.textContent = data.error;
            return;
          }
          loadMonaco(function() {
            ensureEditor();
            currentFile = { category: data.category || 'rules', fileName: data.fileName || '' };
            if (data.ruleFrontmatter) {
              isRuleEditor = true;
              ruleBody = data.body != null ? data.body : '';
              if (ruleControls) ruleControls.classList.add('visible');
              var rf = data.ruleFrontmatter;
              if (ruleTypeSelect) {
                if (rf.alwaysApply === true) ruleTypeSelect.value = 'always';
                else if ((rf.description || '').trim()) ruleTypeSelect.value = 'intelligent';
                else if ((rf.globs || '').trim()) ruleTypeSelect.value = 'files';
                else ruleTypeSelect.value = 'manual';
              }
              if (ruleExtraInput) {
                var rfDesc = (rf.description || '').trim();
                var rfGlobs = (rf.globs || '').trim();
                ruleExtraInput.value = ruleTypeSelect && ruleTypeSelect.value === 'files' ? rfGlobs : rfDesc;
              }
              updateRuleTypeUI();
              editor.updateOptions({ readOnly: true });
              updateRulePreview();
            } else {
              isRuleEditor = false;
              if (ruleControls) ruleControls.classList.remove('visible');
              editor.setValue(data.content || '');
              editor.updateOptions({ readOnly: true });
            }
            showEditor();
            if (editStatus) editStatus.textContent = '';
          });
        }
      });
      }
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
      } else {
        init();
      }
    })();