// ==========================================
// 스마트 컨트랙트 설정
// ==========================================
const CONTRACT_ADDRESS = "0x4d987dA89f02EA30831B8aC02C4A1ccDed3F8E73";

const CONTRACT_ABI = [
    "function startStudy(uint256 amount, uint256 duration, string code) external",
    "function claimReward() external",
    "function mintForTest() external",
    "function balanceOf(address account) external view returns (uint256)",
    "function decimals() external view returns (uint8)",
    "function approve(address spender, uint256 value) external returns (bool)",
    "function sessions(address account) external view returns (uint256 amount, uint256 startTime, uint256 duration, uint8 status)",
    "function giveUp() external",
    "function getGroupMembers(string code) external view returns (address[])",
    "function userToGroup(address user) external view returns (string)"
];

// 전역 상태
let provider;
let signer;
let contract;
let userAddress;
let timerInterval;
let groupPollingInterval;
let myGroupCode = "";

// DOM 요소
const connectBtn = document.getElementById('connectBtn');
const logoutBtn = document.getElementById('logoutBtn');
const dashboard = document.getElementById('dashboard');
const studySection = document.getElementById('studySection');
const walletAddressEl = document.getElementById('walletAddress');
const walletBalanceEl = document.getElementById('walletBalance');
const mintTestBtn = document.getElementById('mintTestBtn');

const groupSelectionArea = document.getElementById('groupSelectionArea');
const groupCodeIn = document.getElementById('groupCode');
const joinGroupBtn = document.getElementById('joinGroupBtn');
const createGroupBtn = document.getElementById('createGroupBtn');

const setupArea = document.getElementById('setupArea');
const timerArea = document.getElementById('timerArea');
const depositAmountIn = document.getElementById('depositAmount');
const studyDurationIn = document.getElementById('studyDuration');
const startStudyBtn = document.getElementById('startStudyBtn');
const backBtn = document.getElementById('backBtn');

const timeRemainingEl = document.getElementById('timeRemaining');
const progressFill = document.getElementById('progressFill');
const timerStatus = document.getElementById('timerStatus');
const claimBtn = document.getElementById('claimBtn');
const giveUpBtn = document.getElementById('giveUpBtn');

const currentGroupCodeEl = document.getElementById('currentGroupCode');
const groupMembersBody = document.getElementById('groupMembersBody');

const loadingOverlay = document.getElementById('loadingOverlay');
const loadingText = document.getElementById('loadingText');

// ==========================================
// 유틸리티 함수
// ==========================================
function showLoading(msg) {
    loadingText.innerText = msg;
    loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
    loadingOverlay.classList.add('hidden');
}

function formatAddress(addr) {
    if (!addr) return '';
    return addr.slice(0, 6) + '...' + addr.slice(-4);
}

function formatTime(seconds) {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

// ==========================================
// 메인 로직
// ==========================================

// 1. 지갑 연결
connectBtn.addEventListener('click', async () => {
    if (typeof window.ethereum === 'undefined') {
        Swal.fire('에러', '메타마스크가 설치되어 있지 않습니다.', 'error');
        return;
    }

    try {
        showLoading("지갑 연결 중...");
        provider = new ethers.BrowserProvider(window.ethereum);
        signer = await provider.getSigner();
        userAddress = await signer.getAddress();
        contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);

        walletAddressEl.innerText = formatAddress(userAddress);
        connectBtn.innerText = "연결됨";
        connectBtn.disabled = true;
        logoutBtn.classList.remove('hidden');

        dashboard.classList.remove('hidden');
        await updateBalance();
        await checkExistingSession();

    } catch (err) {
        console.error(err);
        Swal.fire('연결 실패', '지갑 연결을 거부했거나 오류가 발생했습니다.', 'error');
    } finally {
        hideLoading();
    }
});

logoutBtn.addEventListener('click', () => {
    userAddress = null;
    contract = null;
    myGroupCode = "";

    connectBtn.innerText = "지갑 연결";
    connectBtn.disabled = false;
    logoutBtn.classList.add('hidden');

    dashboard.classList.add('hidden');
    groupSelectionArea.classList.add('hidden');
    studySection.classList.add('hidden');

    if (timerInterval) clearInterval(timerInterval);
    if (groupPollingInterval) clearInterval(groupPollingInterval);
});

// 잔액 업데이트
async function updateBalance() {
    if (!contract || !userAddress) return;
    try {
        const decimals = await contract.decimals();
        const bal = await contract.balanceOf(userAddress);
        const formatted = ethers.formatUnits(bal, decimals);
        walletBalanceEl.innerText = parseFloat(formatted).toFixed(2) + " E2S";
    } catch (e) {
        console.error("잔액 조회 실패:", e);
    }
}

// 2. 그룹 상태 및 진행중인 세션 확인
async function checkExistingSession() {
    try {
        myGroupCode = await contract.userToGroup(userAddress);

        if (!myGroupCode || myGroupCode === "") {
            // 그룹이 없음
            groupSelectionArea.classList.remove('hidden');
            studySection.classList.add('hidden');
        } else {
            // 그룹이 있음
            groupSelectionArea.classList.add('hidden');
            studySection.classList.remove('hidden');
            currentGroupCodeEl.innerText = `(코드: ${myGroupCode})`;

            startGroupPolling();

            const session = await contract.sessions(userAddress);
            const statusInt = Number(session.status); // 0:None, 1:Active, 2:Success, 3:Failed
            if (statusInt === 1) {
                setupArea.classList.add('hidden');
                timerArea.classList.remove('hidden');
                if (backBtn) backBtn.classList.add('hidden'); // 활성 세션 있으면 뒤로가기 숨김

                const startTime = Number(session.startTime);
                const duration = Number(session.duration);
                startTimerCountdown(startTime, duration);
            } else {
                setupArea.classList.remove('hidden');
                timerArea.classList.add('hidden');
                if (backBtn) backBtn.classList.remove('hidden');
            }
        }
    } catch (e) {
        console.error("조회 실패:", e);
    }
}

// 그룹 멤버 현황 폴링
function startGroupPolling() {
    if (groupPollingInterval) clearInterval(groupPollingInterval);
    updateGroupMembers();
    groupPollingInterval = setInterval(updateGroupMembers, 10000); // 10초마다 갱신
}

async function updateGroupMembers() {
    if (!myGroupCode) return;
    try {
        // 온체인 데이터 조회
        const onChainMembers = await contract.getGroupMembers(myGroupCode);
        const decimals = await contract.decimals();

        // 오프체인(로컬스토리지) 대기실 데이터 조회 - 동일 브라우저 데모용
        let localMembers = JSON.parse(localStorage.getItem('waitingRoom_' + myGroupCode) || "[]");

        // 배열 병합 및 중복 제거 (대소문자 구분 없이)
        const allMembersSet = new Set();
        onChainMembers.forEach(addr => allMembersSet.add(addr.toLowerCase()));
        localMembers.forEach(addr => allMembersSet.add(addr.toLowerCase()));

        const allMembers = Array.from(allMembersSet);

        let html = '';

        for (let m of allMembers) {
            // 원본 주소 대소문자 복구를 위해 checksum 주소로 변환 시도, 실패시 그대로 사용
            let displayAddress = m;
            try { displayAddress = ethers.getAddress(m); } catch (e) { }

            const session = await contract.sessions(displayAddress);
            const amount = ethers.formatUnits(session.amount, decimals);
            const duration = Number(session.duration);
            const statusInt = Number(session.status);

            let statusText = '-';
            let statusColor = 'inherit';

            if (statusInt === 0) { statusText = '대기 중 👀'; statusColor = '#94a3b8'; }
            else if (statusInt === 1) { statusText = '진행 중 ⏳'; statusColor = '#f39c12'; }
            else if (statusInt === 2) { statusText = '성공 '; statusColor = '#2ecc71'; }
            else if (statusInt === 3) { statusText = '실패'; statusColor = '#e74c3c'; }

            const isMe = displayAddress.toLowerCase() === userAddress.toLowerCase() ? ' (나)' : '';

            html += `
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                    <td style="padding: 10px 0;">${formatAddress(displayAddress)}${isMe}</td>
                    <td style="padding: 10px 0;">${amount > 0 ? amount : '-'}</td>
                    <td style="padding: 10px 0;">${duration > 0 ? duration + '초' : '-'}</td>
                    <td style="padding: 10px 0; color: ${statusColor}; font-weight: bold;">${statusText}</td>
                </tr>
            `;
        }

        if (allMembers.length === 0) {
            html = `<tr><td colspan="4" style="text-align:center; padding:10px;">멤버가 없습니다.</td></tr>`;
        }

        groupMembersBody.innerHTML = html;
    } catch (e) {
        console.error("멤버 조회 실패", e);
    }
}

// 3. 그룹 생성 / 참여 (트랜잭션 없이 로컬 처리)
createGroupBtn.addEventListener('click', () => {
    const randomCode = "ST-" + Math.random().toString(36).substr(2, 4).toUpperCase();
    myGroupCode = randomCode;

    // 로컬스토리지에 대기실 멤버 추가 (데모용)
    let waitingRoom = JSON.parse(localStorage.getItem('waitingRoom_' + myGroupCode) || "[]");
    if (!waitingRoom.includes(userAddress)) {
        waitingRoom.push(userAddress);
        localStorage.setItem('waitingRoom_' + myGroupCode, JSON.stringify(waitingRoom));
    }

    groupSelectionArea.classList.add('hidden');
    studySection.classList.remove('hidden');
    currentGroupCodeEl.innerText = `(코드: ${myGroupCode})`;

    setupArea.classList.remove('hidden');
    timerArea.classList.add('hidden');
    if (backBtn) backBtn.classList.remove('hidden');

    startGroupPolling();
    Swal.fire('방 생성 완료', `새 방 코드는 ${randomCode} 입니다. 친구들에게 공유하세요!`, 'success');
});

joinGroupBtn.addEventListener('click', async () => {
    const code = groupCodeIn.value.trim().toUpperCase();
    if (!code) return Swal.fire('알림', '방 코드를 입력하세요.', 'warning');

    myGroupCode = code;

    // 로컬스토리지에 대기실 멤버 추가 (데모용)
    let waitingRoom = JSON.parse(localStorage.getItem('waitingRoom_' + myGroupCode) || "[]");
    if (!waitingRoom.includes(userAddress)) {
        waitingRoom.push(userAddress);
        localStorage.setItem('waitingRoom_' + myGroupCode, JSON.stringify(waitingRoom));
    }

    groupSelectionArea.classList.add('hidden');
    studySection.classList.remove('hidden');
    currentGroupCodeEl.innerText = `(코드: ${myGroupCode})`;

    startGroupPolling();

    try {
        const session = await contract.sessions(userAddress);
        const statusInt = Number(session.status);
        if (statusInt === 1) {
            setupArea.classList.add('hidden');
            timerArea.classList.remove('hidden');
            if (backBtn) backBtn.classList.add('hidden');
            const startTime = Number(session.startTime);
            const duration = Number(session.duration);
            startTimerCountdown(startTime, duration);
        } else {
            setupArea.classList.remove('hidden');
            timerArea.classList.add('hidden');
            if (backBtn) backBtn.classList.remove('hidden');
        }
    } catch (e) {
        console.error("세션 조회 중 에러:", e);
    }
});

backBtn.addEventListener('click', () => {
    myGroupCode = "";
    if (groupPollingInterval) clearInterval(groupPollingInterval);

    studySection.classList.add('hidden');
    groupSelectionArea.classList.remove('hidden');
});

// 4. 테스트 토큰 받기
mintTestBtn.addEventListener('click', async () => {
    try {
        showLoading("테스트 토큰 민팅 중...");
        const tx = await contract.mintForTest();
        await tx.wait();
        await updateBalance();
        Swal.fire('성공', '테스트용 E2S 토큰 1000개를 받았습니다!', 'success');
    } catch (e) {
        console.error(e);
        Swal.fire('실패', '토큰 민팅에 실패했습니다.', 'error');
    } finally {
        hideLoading();
    }
});

// 5. 공부 시작 (예치)
startStudyBtn.addEventListener('click', async () => {
    const amountStr = depositAmountIn.value;
    const durationStr = studyDurationIn.value;

    if (!amountStr || !durationStr || Number(amountStr) <= 0 || Number(durationStr) <= 0) {
        Swal.fire('알림', '정확한 수치를 입력해주세요.', 'warning');
        return;
    }

    try {
        const decimals = await contract.decimals();
        const amountWei = ethers.parseUnits(amountStr, decimals);

        showLoading("예치 트랜잭션 전송 중...");
        const startTx = await contract.startStudy(amountWei, Number(durationStr), myGroupCode);
        await startTx.wait();

        await updateBalance();
        await checkExistingSession(); // 폴링 및 UI 갱신

        Swal.fire('예치 완료', '목표를 향해 달려보세요!', 'success');

    } catch (e) {
        console.error(e);
        Swal.fire('실패', '트랜잭션 중 오류가 발생했습니다.', 'error');
    } finally {
        hideLoading();
    }
});

// 6. 타이머 카운트다운 로직
function startTimerCountdown(startTime, duration) {
    if (timerInterval) clearInterval(timerInterval);

    claimBtn.classList.add('hidden');
    giveUpBtn.classList.remove('hidden');
    timerStatus.innerText = "열심히 공부하는 중...";
    timerStatus.style.color = "var(--text-muted)";

    const endTime = startTime + duration;

    const updateTimer = () => {
        const now = Math.floor(Date.now() / 1000);
        const remaining = endTime - now;

        if (remaining <= 0) {
            clearInterval(timerInterval);
            timeRemainingEl.innerText = "00:00";
            progressFill.style.width = "0%";
            timerStatus.innerText = "🎉 목표 달성! 보상을 수령하세요!";
            timerStatus.style.color = "var(--success-color)";
            claimBtn.classList.remove('hidden');
            giveUpBtn.classList.add('hidden');
        } else {
            timeRemainingEl.innerText = formatTime(remaining);
            const passed = now - startTime;
            const progress = Math.max(0, 100 - (passed / duration) * 100);
            progressFill.style.width = `${progress}%`;
        }
    };

    updateTimer();
    timerInterval = setInterval(updateTimer, 1000);
}

// 7. 보상 수령 (Claim)
claimBtn.addEventListener('click', async () => {
    try {
        showLoading("보상 수령 트랜잭션 전송 중...");
        const claimTx = await contract.claimReward();
        await claimTx.wait();

        await updateBalance();

        setupArea.classList.remove('hidden');
        timerArea.classList.add('hidden');

        depositAmountIn.value = '';
        studyDurationIn.value = '';

        Swal.fire({
            title: '목표 달성! 🚀',
            text: '원금과 5% 보상이 성공적으로 지급되었습니다!',
            icon: 'success',
            confirmButtonText: '확인'
        });

        updateGroupMembers(); // 멤버 상태 즉시 갱신

    } catch (e) {
        console.error(e);
        let msg = "오류가 발생했습니다.";
        if (e.message && e.message.includes("Study time not finished")) {
            msg = "블록체인 상에서는 아직 시간이 다 지나지 않았습니다. (약 10~20초 뒤에 다시 시도해주세요)";
            Swal.fire('시간 대기', msg, 'info');
        } else {
            Swal.fire('실패', msg, 'error');
        }
    } finally {
        hideLoading();
    }
});

// 8. 공부 포기 (Give Up)
giveUpBtn.addEventListener('click', async () => {
    try {
        const result = await Swal.fire({
            title: '정말 포기하시겠습니까?',
            text: '포기하면 예치금이 몰수됩니다!',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: '네, 포기합니다',
            cancelButtonText: '아니요, 계속할게요',
            confirmButtonColor: '#d33'
        });

        if (result.isConfirmed) {
            showLoading("포기 트랜잭션 전송 중...");
            const tx = await contract.giveUp();
            await tx.wait();

            await updateBalance();
            if (timerInterval) clearInterval(timerInterval);

            setupArea.classList.remove('hidden');
            timerArea.classList.add('hidden');

            depositAmountIn.value = '';
            studyDurationIn.value = '';

            Swal.fire('포기 완료', '예치금이 몰수되었습니다. 다음에는 꼭 성공하세요!', 'error');

            updateGroupMembers(); // 멤버 상태 즉시 갱신
        }
    } catch (e) {
        console.error(e);
        Swal.fire('실패', '트랜잭션 중 오류가 발생했습니다.', 'error');
    } finally {
        hideLoading();
    }
});

// 메타마스크 계정 변경 감지
if (window.ethereum) {
    window.ethereum.on('accountsChanged', () => {
        window.location.reload();
    });
}
