// ==========================================
// 스마트 컨트랙트 설정
// ==========================================
const CONTRACT_ADDRESS = "0xC05047F5c717A676a32cc07EdE7E369ba3572566";

const CONTRACT_ABI = [
    "function startStudy(uint256 amount, uint256 duration) external",
    "function claimReward() external",
    "function mintForTest() external",
    "function balanceOf(address account) external view returns (uint256)",
    "function decimals() external view returns (uint8)",
    "function approve(address spender, uint256 value) external returns (bool)",
    "function sessions(address account) external view returns (uint256 amount, uint256 startTime, uint256 duration, bool isActive)",
    "function giveUp() external"
];

// 전역 상태
let provider;
let signer;
let contract;
let userAddress;
let timerInterval;

// DOM 요소
const connectBtn = document.getElementById('connectBtn');
const dashboard = document.getElementById('dashboard');
const studySection = document.getElementById('studySection');
const walletAddressEl = document.getElementById('walletAddress');
const walletBalanceEl = document.getElementById('walletBalance');
const mintTestBtn = document.getElementById('mintTestBtn');

const setupArea = document.getElementById('setupArea');
const timerArea = document.getElementById('timerArea');
const depositAmountIn = document.getElementById('depositAmount');
const studyDurationIn = document.getElementById('studyDuration');
const startStudyBtn = document.getElementById('startStudyBtn');

const timeRemainingEl = document.getElementById('timeRemaining');
const progressFill = document.getElementById('progressFill');
const timerStatus = document.getElementById('timerStatus');
const claimBtn = document.getElementById('claimBtn');
const giveUpBtn = document.getElementById('giveUpBtn');

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

        // Ethers v6 문법
        provider = new ethers.BrowserProvider(window.ethereum);
        signer = await provider.getSigner();
        userAddress = await signer.getAddress();

        contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);

        walletAddressEl.innerText = formatAddress(userAddress);
        connectBtn.innerText = "연결됨";
        connectBtn.disabled = true;

        dashboard.classList.remove('hidden');
        studySection.classList.remove('hidden');

        await updateBalance();
        await checkExistingSession();

    } catch (err) {
        console.error(err);
        Swal.fire('연결 실패', '지갑 연결을 거부했거나 오류가 발생했습니다.', 'error');
    } finally {
        hideLoading();
    }
});

// 잔액 업데이트
async function updateBalance() {
    if (!contract || !userAddress) return;
    try {
        const decimals = await contract.decimals();
        const bal = await contract.balanceOf(userAddress);
        const formatted = ethers.formatUnits(bal, decimals);
        // 소수점 2자리까지만 표시
        walletBalanceEl.innerText = parseFloat(formatted).toFixed(2) + " E2S";
    } catch (e) {
        console.error("잔액 조회 실패:", e);
    }
}

// 기존 진행중인 세션 확인
async function checkExistingSession() {
    try {
        const session = await contract.sessions(userAddress);
        if (session.isActive) {
            setupArea.classList.add('hidden');
            timerArea.classList.remove('hidden');

            const startTime = Number(session.startTime);
            const duration = Number(session.duration);
            startTimerCountdown(startTime, duration);
        }
    } catch (e) {
        console.error("세션 조회 실패:", e);
    }
}

// 2. 테스트 토큰 받기
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

// 3. 공부 시작 (예치)
startStudyBtn.addEventListener('click', async () => {
    const amountStr = depositAmountIn.value;
    const durationStr = studyDurationIn.value;

    if (!amountStr || !durationStr || Number(amountStr) <= 0 || Number(durationStr) <= 0) {
        Swal.fire('알림', '정확한 수치를 입력해주세요.', 'warning');
        return;
    }

    if (CONTRACT_ADDRESS === "0x0000000000000000000000000000000000000000") {
        Swal.fire('컨트랙트 주소 누락', 'app.js에서 CONTRACT_ADDRESS를 변경하세요.', 'error');
        return;
    }

    try {
        showLoading("1/2: 토큰 사용 승인 중...");
        const decimals = await contract.decimals();
        const amountWei = ethers.parseUnits(amountStr, decimals);

        // Approve (컨트랙트 내부 구현 구조상, 자신에게 allowance를 부여해야 합니다)
        const approveTx = await contract.approve(userAddress, amountWei);
        await approveTx.wait();

        showLoading("2/2: 예치 트랜잭션 전송 중...");
        const startTx = await contract.startStudy(amountWei, Number(durationStr));
        await startTx.wait();

        await updateBalance();

        // UI 변경
        setupArea.classList.add('hidden');
        timerArea.classList.remove('hidden');

        // 타이머 시작 (현재 시간 기준)
        const block = await provider.getBlock('latest');
        startTimerCountdown(block.timestamp, Number(durationStr));

        Swal.fire('예치 완료', '목표를 향해 달려보세요!', 'success');

    } catch (e) {
        console.error(e);
        Swal.fire('실패', '트랜잭션 중 오류가 발생했습니다.', 'error');
    } finally {
        hideLoading();
    }
});

// 4. 타이머 카운트다운 로직
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

// 5. 보상 수령 (Claim)
claimBtn.addEventListener('click', async () => {
    try {
        showLoading("보상 수령 트랜잭션 전송 중...");
        const claimTx = await contract.claimReward();
        await claimTx.wait();

        await updateBalance();

        setupArea.classList.remove('hidden');
        timerArea.classList.add('hidden');

        // 초기화
        depositAmountIn.value = '';
        studyDurationIn.value = '';

        Swal.fire({
            title: '목표 달성! 🚀',
            text: '원금과 5% 보상이 성공적으로 지급되었습니다!',
            icon: 'success',
            confirmButtonText: '확인'
        });

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

// 6. 공부 포기 (Give Up)
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
