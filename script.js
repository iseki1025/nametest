// DOM要素の取得
const cardListSection = document.getElementById('card-list-section');
const cameraSection = document.getElementById('camera-section');
const editSection = document.getElementById('edit-section');

const addCardButton = document.getElementById('add-card-button');
const videoStream = document.getElementById('video-stream');
const captureButton = document.getElementById('capture-button');
const cameraBackButton = document.getElementById('camera-back-button');
const canvas = document.getElementById('canvas');
const ocrStatus = document.getElementById('ocr-status');

const cardForm = document.getElementById('card-form');
const editName = document.getElementById('edit-name');
const editCompany = document.getElementById('edit-company');
const editTitle = document.getElementById('edit-title');
const editPhone = document.getElementById('edit-phone');
const editEmail = document.getElementById('edit-email');
const editAddress = document.getElementById('edit-address');
const editFullText = document.getElementById('edit-full-text');
const saveCardButton = document.getElementById('save-card-button');
const deleteCardButton = document.getElementById('delete-card-button');
const editBackButton = document.getElementById('edit-back-button');

const cardListUl = document.getElementById('card-list');
const searchInput = document.getElementById('search-input');

let currentStream; // カメラストリームを保持する変数
let editingCardId = null; // 編集中の名刺ID

// 画面切り替え関数
function showSection(section) {
    cardListSection.classList.add('hidden');
    cameraSection.classList.add('hidden');
    editSection.classList.add('hidden');
    section.classList.remove('hidden');
}

// カメラストリームを停止する関数
function stopCamera() {
    if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
        videoStream.srcObject = null;
    }
}

const DB_NAME = 'BusinessCardDB';
const STORE_NAME = 'cards';
const DB_VERSION = 1;

let db;

function openDb() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
            }
        };

        request.onsuccess = (event) => {
            db = event.target.result;
            resolve(db);
        };

        request.onerror = (event) => {
            console.error('IndexedDB error:', event.target.errorCode);
            reject(event.target.errorCode);
        };
    });
}

// 名刺データを保存 (追加/更新)
async function saveCard(cardData) {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(cardData); // idがあれば更新、なければ追加

    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve();
        request.onerror = (event) => reject(event.target.errorCode);
    });
}

// 全名刺データを取得
async function getAllCards() {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    return new Promise((resolve, reject) => {
        request.onsuccess = (event) => resolve(event.target.result);
        request.onerror = (event) => reject(event.target.errorCode);
    });
}

// 名刺データをIDで取得
async function getCardById(id) {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);

    return new Promise((resolve, reject) => {
        request.onsuccess = (event) => resolve(event.target.result);
        request.onerror = (event) => reject(event.target.errorCode);
    });
}

// 名刺データを削除
async function deleteCard(id) {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);

    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve();
        request.onerror = (event) => reject(event.target.errorCode);
    });
}

let worker; // Tesseract.jsのワーカー

async function initializeTesseract() {
    if (worker) return; // 既に初期化済みなら何もしない

    ocrStatus.textContent = 'OCRワーカーを初期化中...';
    try {
        worker = Tesseract.createWorker({
            // langPath: './lib/lang-data/', // 言語データのパスを指定 (CDN利用の場合は不要)
            logger: m => {
                // OCRの進捗を表示 (m.status, m.progress)
                if (m.status === 'recognizing text') {
                    ocrStatus.textContent = `OCR処理中: ${Math.round(m.progress * 100)}%`;
                } else {
                    ocrStatus.textContent = `OCRステータス: ${m.status}`;
                }
            }
        });

        await worker.load();
        // 日本語と英語をロード
        await worker.loadLanguage('jpn');
        await worker.loadLanguage('eng');
        await worker.initialize('jpn+eng'); // 複数の言語を認識する設定
        ocrStatus.textContent = 'OCRワーカー初期化完了。';
    } catch (error) {
        console.error('Tesseract.jsの初期化に失敗しました:', error);
        ocrStatus.textContent = 'OCRワーカーの初期化に失敗しました。';
        alert('OCRエンジンの読み込みに失敗しました。インターネット接続を確認するか、ブラウザを再起動してください。');
    }
}

async function performOcr(image) {
    if (!worker) {
        await initializeTesseract();
    }
    if (!worker) { // 初期化に失敗したら実行しない
        return { text: '' };
    }

    ocrStatus.textContent = 'OCR処理を開始...';
    try {
        const { data: { text } } = await worker.recognize(image);
        ocrStatus.textContent = 'OCR処理が完了しました！';
        return { text };
    } catch (error) {
        console.error('OCR処理中にエラーが発生しました:', error);
        ocrStatus.textContent = 'OCR処理中にエラーが発生しました。';
        return { text: '' };
    }
}

// OCR結果から名刺の各項目を推測する簡易ロジック
// 実際の製品では、正規表現やより複雑なAIモデルが必要
function parseOcrResult(fullText) {
    const lines = fullText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    let name = '';
    let company = '';
    let title = '';
    let phone = '';
    let email = '';
    let address = '';

    // 簡易的なキーワードマッチング
    lines.forEach(line => {
        if (!name && line.length > 2 && !/[0-9]/.test(line) && !line.includes('@')) {
            // 数字や@を含まず、ある程度の長さの行を名前に推測 (非常に単純)
            // ここで、苗字と名前を判断したりするロジックが必要
            name = line;
        }
        if (line.includes('株式会社') || line.includes('有限会社') || line.includes('Co.,Ltd.') || line.includes('Corp.')) {
            company = line;
        }
        if (line.includes('Tel:') || line.includes('TEL:') || line.includes('電話:') || /\d{2,4}-\d{2,4}-\d{4}/.test(line) || /\+\d{1,3}\s?\(\d{1,4}\)\s?\d{4,}-\d{4,}/.test(line)) {
            phone = line.replace(/Tel:|TEL:|電話:|\s/g, ''); // Tel:などを削除
        }
        if (line.includes('@') && line.includes('.')) {
            email = line;
        }
        if (/[〒T]\d{3}-?\d{4}/.test(line) || line.includes('都') || line.includes('道') || line.includes('府') || line.includes('県')) {
            address = line;
        }
        if (line.includes('代表取締役') || line.includes('部長') || line.includes('課長') || line.includes('Manager') || line.includes('CEO') || line.includes('Director')) {
            title = line;
        }
    });

    return { name, company, title, phone, email, address };
}

// アプリ起動時の処理
document.addEventListener('DOMContentLoaded', async () => {
    await openDb(); // IndexedDBを開く
    displayCards(); // 名刺リストを表示
    initializeTesseract(); // OCRワーカーを初期化
});

// 名刺追加ボタンクリック
addCardButton.addEventListener('click', async () => {
    showSection(cameraSection);
    try {
        currentStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); // 背面カメラを優先
        videoStream.srcObject = currentStream;
        videoStream.play();
    } catch (err) {
        console.error("カメラへのアクセスに失敗しました: ", err);
        alert("カメラへのアクセスが許可されていません。ブラウザの設定をご確認ください。");
        showSection(cardListSection); // 失敗したらリスト画面に戻る
    }
});

// カメラ戻るボタン
cameraBackButton.addEventListener('click', () => {
    stopCamera();
    showSection(cardListSection);
});

// 撮影ボタンクリック
captureButton.addEventListener('click', () => {
    const context = canvas.getContext('2d');
    canvas.width = videoStream.videoWidth;
    canvas.height = videoStream.videoHeight;
    context.drawImage(videoStream, 0, 0, canvas.width, canvas.height);

    stopCamera(); // カメラストリームを停止
    showSection(editSection); // 編集画面へ遷移

    // OCR実行
    performOcr(canvas)
        .then(result => {
            editFullText.value = result.text;
            const parsedData = parseOcrResult(result.text);
            editName.value = parsedData.name;
            editCompany.value = parsedData.company;
            editTitle.value = parsedData.title;
            editPhone.value = parsedData.phone;
            editEmail.value = parsedData.email;
            editAddress.value = parsedData.address;
            
            saveCardButton.textContent = '保存';
            deleteCardButton.classList.add('hidden');
            editingCardId = null; // 新規追加なのでIDをクリア
        })
        .catch(err => {
            console.error('OCR処理エラー:', err);
            editFullText.value = 'OCR処理中にエラーが発生しました。手動で入力してください。';
        });
});

// 名刺フォームの保存/更新
cardForm.addEventListener('submit', async (event) => {
    event.preventDefault(); // フォームのデフォルト送信を防止

    const cardData = {
        id: editingCardId, // 既存の名刺ならID、新規ならnull
        name: editName.value,
        company: editCompany.value,
        title: editTitle.value,
        phone: editPhone.value,
        email: editEmail.value,
        address: editAddress.value,
        ocr_text: editFullText.value, // OCRの生テキストも保存
        updated_at: new Date().toISOString()
    };
    
    if (editingCardId === null) {
        cardData.created_at = new Date().toISOString(); // 新規作成時のみ
    }

    try {
        await saveCard(cardData);
        alert('名刺データを保存しました！');
        displayCards(); // リストを更新
        showSection(cardListSection); // リスト画面に戻る
    } catch (err) {
        console.error('名刺データの保存に失敗しました:', err);
        alert('名刺データの保存に失敗しました。');
    }
});

// 編集キャンセルボタン
editBackButton.addEventListener('click', () => {
    showSection(cardListSection);
});

// 名刺リストの表示と検索
async function displayCards(filterKeyword = '') {
    cardListUl.innerHTML = ''; // リストをクリア
    const cards = await getAllCards();
    const lowerCaseKeyword = filterKeyword.toLowerCase();

    const filteredCards = cards.filter(card =>
        card.name.toLowerCase().includes(lowerCaseKeyword) ||
        card.company.toLowerCase().includes(lowerCaseKeyword) ||
        card.phone.toLowerCase().includes(lowerCaseKeyword) ||
        card.email.toLowerCase().includes(lowerCaseKeyword) ||
        card.address.toLowerCase().includes(lowerCaseKeyword) ||
        card.ocr_text.toLowerCase().includes(lowerCaseKeyword)
    );

    filteredCards.forEach(card => {
        const li = document.createElement('li');
        li.innerHTML = `
            <div>
                <div class="name">${card.name || '名前なし'}</div>
                <div class="company">${card.company || '会社名なし'}</div>
            </div>
        `;
        li.dataset.cardId = card.id; // データIDを要素に保存

        li.addEventListener('click', async () => {
            // 名刺詳細表示と編集画面へ
            const cardData = await getCardById(parseInt(li.dataset.cardId));
            if (cardData) {
                editingCardId = cardData.id;
                editName.value = cardData.name || '';
                editCompany.value = cardData.company || '';
                editTitle.value = cardData.title || '';
                editPhone.value = cardData.phone || '';
                editEmail.value = cardData.email || '';
                editAddress.value = cardData.address || '';
                editFullText.value = cardData.ocr_text || ''; // OCR生テキスト
                
                saveCardButton.textContent = '更新';
                deleteCardButton.classList.remove('hidden');
                showSection(editSection);
            }
        });
        cardListUl.appendChild(li);
    });
}

// 検索入力時にリストを更新
searchInput.addEventListener('input', (event) => {
    displayCards(event.target.value);
});

// 名刺削除ボタン
deleteCardButton.addEventListener('click', async () => {
    if (confirm('この名刺データを本当に削除しますか？')) {
        try {
            await deleteCard(editingCardId);
            alert('名刺データを削除しました。');
            displayCards();
            showSection(cardListSection);
        } catch (err) {
            console.error('名刺データの削除に失敗しました:', err);
            alert('名刺データの削除に失敗しました。');
        }
    }
});