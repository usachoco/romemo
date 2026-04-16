(function() {
    // target_xpath.txt の内容に基づきターゲット要素を取得
    const xpath = "/html/body/div[1]/div/main/div/div[2]/div/div/article/div[2]/div/div[3]";
    const container = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;

    if (!container) {
        console.error("Target container not found.");
        return;
    }

    const table = container.querySelector("table.table");
    if (!table) {
        console.error("Table not found within the container.");
        return;
    }

    // --- 1. テーブル構造の解析と「価格」列の挿入 ---

    const rows = Array.from(table.rows);
    if (rows.length === 0) return;

    // 論理的なマトリックスを作成して rowspan を正規化する
    function buildMatrix(tblRows) {
        const matrix = [];
        tblRows.forEach((row, rowIndex) => {
            if (!matrix[rowIndex]) matrix[rowIndex] = [];
            let logicalColIdx = 0;
            Array.from(row.cells).forEach(cell => {
                while (matrix[rowIndex][logicalColIdx]) logicalColIdx++;
                const rs = cell.rowSpan || 1;
                const cs = cell.colSpan || 1;
                for (let r = 0; r < rs; r++) {
                    if (!matrix[rowIndex + r]) matrix[rowIndex + r] = [];
                    for (let c = 0; c < cs; c++) {
                        matrix[rowIndex + r][logicalColIdx + c] = {
                            cell: cell,
                            isPrimary: r === 0 && c === 0,
                            rowSpan: rs,
                            colSpan: cs
                        };
                    }
                }
                logicalColIdx += cs;
            });
        });
        return matrix;
    }

    let matrix = buildMatrix(rows);

    // 「価格」列を挿入する
    rows.forEach((row, rowIndex) => {
        if (rowIndex === 0) {
            // ヘッダー行
            const newTh = document.createElement("td");
            newTh.width = "100";
            newTh.style.fontWeight = "bold";
            newTh.innerHTML = "価格";
            // 2列目（対象アイテム名）の直後に挿入
            row.cells[1].insertAdjacentElement('afterend', newTh);
        } else {
            // データ行
            const col2Info = matrix[rowIndex][1];
            // 2列目のセルの実体がある行（rowspanの開始行）にのみ挿入
            if (col2Info && col2Info.isPrimary) {
                const col5Info = matrix[rowIndex][4];
                const valueFromCol4 = col5Info ? col5Info.cell.textContent.trim() : "";
                
                const newTd = document.createElement("td");
                if (col2Info.rowSpan > 1) {
                    newTd.rowSpan = col2Info.rowSpan;
                }

                if (valueFromCol4 === "ー") {
                    newTd.innerHTML = "ー";
                } else {
                    const match = valueFromCol4.replace(/,/g, '').match(/[0-9]+/);
                    if (match) {
                        const originalValue = parseInt(match[0], 10);
                        const calculatedValue = originalValue * 5;
                        newTd.innerHTML = calculatedValue.toLocaleString() + " 円";
                    } else {
                        newTd.innerHTML = "ー";
                    }
                }
                col2Info.cell.insertAdjacentElement('afterend', newTd);
            }
        }
    });

    // 列挿入後の状態でマトリックスを再構築
    matrix = buildMatrix(Array.from(table.rows));

    // --- 2. フィルタ UI の作成 ---

    const filterContainer = document.createElement("div");
    filterContainer.style.marginBottom = "10px";
    filterContainer.style.padding = "10px";
    filterContainer.style.border = "1px solid #ccc";
    filterContainer.style.backgroundColor = "#f9f9f9";
    filterContainer.innerHTML = `
        <div style="display: flex; gap: 20px; align-items: center; font-size: 14px;">
            <div>
                アイテム名検索: <input type="text" id="filter-item" placeholder="部分一致..." style="padding: 4px;">
            </div>
            <div>
                価格検索: <input type="text" id="filter-price" placeholder="部分一致..." style="padding: 4px;">
            </div>
        </div>
    `;
    table.parentNode.insertBefore(filterContainer, table);

    // --- 3. フィルタリングロジックの実装 ---

    const inputItem = document.getElementById("filter-item");
    const inputPrice = document.getElementById("filter-price");

    function applyFilter() {
        const valItem = inputItem.value.toLowerCase();
        const valPrice = inputPrice.value.toLowerCase();
        const dataRows = Array.from(table.rows).slice(1);
        
        // 各行の表示・非表示を判定
        const rowVisibilities = dataRows.map((row, idx) => {
            const rowIndex = idx + 1;
            const itemText = matrix[rowIndex][1].cell.textContent.toLowerCase();
            const priceText = matrix[rowIndex][2].cell.textContent.toLowerCase();
            return itemText.includes(valItem) && priceText.includes(valPrice);
        });

        // 全てのセルについて、表示される最初の行に移動し、rowspanを調整する
        // 処理対象は rowspan が発生しうる 1, 2, 3列目（論理インデックス 0, 1, 2）
        for (let colIdx = 0; colIdx <= 2; colIdx++) {
            let r = 1;
            while (r < matrix.length) {
                const info = matrix[r][colIdx];
                if (!info) { r++; continue; }
                
                const cell = info.cell;
                const spanStart = r;
                const spanEnd = r + info.rowSpan;
                
                // この span 範囲内で表示される行を抽出
                const visibleIndicesInSpan = [];
                for (let i = spanStart; i < spanEnd; i++) {
                    if (rowVisibilities[i - 1]) {
                        visibleIndicesInSpan.push(i);
                    }
                }

                if (visibleIndicesInSpan.length > 0) {
                    const firstVisibleRowIdx = visibleIndicesInSpan[0];
                    const targetRow = table.rows[firstVisibleRowIdx];
                    
                    // セルを正しい位置に移動させる必要がある
                    // ターゲット行の「自分より左の列」のセルの直後に挿入する
                    let insertAfter = null;
                    for (let c = colIdx - 1; c >= 0; c--) {
                        if (matrix[firstVisibleRowIdx][c] && matrix[firstVisibleRowIdx][c].cell.parentNode === targetRow) {
                            insertAfter = matrix[firstVisibleRowIdx][c].cell;
                            break;
                        }
                    }

                    if (insertAfter) {
                        insertAfter.insertAdjacentElement('afterend', cell);
                    } else {
                        targetRow.insertBefore(cell, targetRow.firstChild);
                    }

                    cell.rowSpan = visibleIndicesInSpan.length;
                    cell.style.display = "";
                } else {
                    cell.style.display = "none";
                }

                r = spanEnd; // 次の span 単位へ
            }
        }

        // 行自体の表示切り替え
        dataRows.forEach((row, idx) => {
            row.style.display = rowVisibilities[idx] ? "" : "none";
        });
    }

    inputItem.addEventListener("input", applyFilter);
    inputPrice.addEventListener("input", applyFilter);
})();
