// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// OpenZeppelin 라이브러리 임포트: 안전하고 검증된 표준 스마트 컨트랙트 코드 활용
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title EarnToStudy (E2S)
 * @dev 사용자가 토큰을 예치하고 목표 공부 시간을 달성하면 보상을 받는 동기부여형 스마트 컨트랙트입니다.
 * 발표 포인트: 이 컨트랙트 하나가 'E2S'라는 암호화폐(ERC-20)의 역할과, 
 * 사용자의 예치금 및 시간을 관리하는 '예치(Staking)' 로직을 모두 수행합니다.
 */
contract EarnToStudy is ERC20, Ownable {
    
    // [구조체 정의] 개별 사용자의 공부 세션 정보를 저장하기 위한 틀입니다.
    struct StudySession {
        uint256 amount;     // 사용자가 걸어둔 예치금 (E2S 토큰 수량)
        uint256 startTime;  // 공부를 시작한 블록체인 상의 시간 (타임스탬프)
        uint256 duration;   // 사용자가 약속한 목표 공부 시간 (초 단위)
        bool isActive;      // 현재 공부가 진행 중인지(true) 끝났는지(false) 상태 표시
    }
    
    // [상태 변수] 사용자 지갑 주소(address)를 넣으면 해당 사용자의 StudySession 정보를 찾아주는 매핑 테이블입니다.
    mapping(address => StudySession) public sessions;
    
    // [상수] 성공 시 지급할 보상 비율입니다. (여기서는 예치금의 5%로 설정)
    uint256 public constant REWARD_PERCENTAGE = 5;
    
    // [이벤트] 블록체인 외부에(웹 프론트엔드 등) 트랜잭션 결과를 알리기 위한 신호탄 역할입니다.
    event StudyStarted(address indexed user, uint256 amount, uint256 duration); // 시작했을 때
    event RewardClaimed(address indexed user, uint256 totalAmount, uint256 rewardAmount); // 보상 수령했을 때
    event StudyFailed(address indexed user, uint256 slashedAmount); // 실패하여 몰수당했을 때
    
    /**
     * @dev [생성자] 컨트랙트가 최초로 블록체인에 배포될 때 단 한 번 실행됩니다.
     * 발표 포인트: 토큰의 이름("Earn To Study")과 심볼("E2S")을 설정하고,
     * 배포자(msg.sender)에게 초기 유동성으로 100만 E2S 토큰을 발행(Mint)합니다.
     */
    constructor() ERC20("Earn To Study", "E2S") Ownable(msg.sender) {
        // decimals()는 기본적으로 18을 반환하므로, 1,000,000 * 10^18 단위로 발행됩니다.
        _mint(msg.sender, 1000000 * 10 ** decimals());
    }
    
    /**
     * @dev [핵심 기능 1: 공부 시작] 예치금을 걸고 타이머를 시작합니다.
     * 발표 포인트: 조건문(require)을 통해 잘못된 값이나 중복 참여를 방지하고,
     * 사용자의 지갑에서 컨트랙트(이곳)로 토큰을 가져옵니다(transferFrom).
     */
    function startStudy(uint256 amount, uint256 duration) external {
        // 1. 유효성 검사: 예치금과 목표 시간이 0보다 커야 하고, 이미 진행 중인 세션이 없어야 합니다.
        require(amount > 0, "Amount must be greater than 0");
        require(duration > 0, "Duration must be greater than 0");
        require(!sessions[msg.sender].isActive, "Already studying");
        
        // 2. 예치금 이체: 사용자의 토큰을 스마트 컨트랙트로 전송합니다.
        // (프론트엔드에서 먼저 이 컨트랙트가 내 토큰을 가져갈 수 있도록 approve 해주는 과정이 선행되어야 합니다)
        require(transferFrom(msg.sender, address(this), amount), "Transfer failed");
        
        // 3. 세션 정보 저장: 현재 블록체인의 시간(block.timestamp)을 시작 시간으로 기록합니다.
        sessions[msg.sender] = StudySession({
            amount: amount,
            startTime: block.timestamp,
            duration: duration,
            isActive: true
        });
        
        // 4. 이벤트 발생: 프론트엔드에 공부가 시작되었음을 알립니다.
        emit StudyStarted(msg.sender, amount, duration);
    }
    
    /**
     * @dev [핵심 기능 2: 보상 수령] 목표 시간을 채운 사용자가 원금과 5% 보상을 받습니다.
     * 발표 포인트: 블록체인 상의 시간(block.timestamp)이 '시작시간+목표시간'을 넘었는지 엄격히 검사합니다.
     */
    function claimReward() external {
        // 1. 내 세션 정보 불러오기
        StudySession storage session = sessions[msg.sender];
        require(session.isActive, "No active study session");
        
        // 2. 목표 시간 달성 여부 확인: 현재 시간이 (시작시간 + 목표시간) 보다 크거나 같아야 통과됩니다.
        require(block.timestamp >= session.startTime + session.duration, "Study time not finished yet");
        
        // 3. 보상금 계산: 원금의 5% 계산
        uint256 rewardAmount = (session.amount * REWARD_PERCENTAGE) / 100;
        uint256 totalPayout = session.amount + rewardAmount;
        
        // 4. 상태 업데이트: 세션 종료 처리 (중복 수령 방지)
        session.isActive = false;
        
        // 5. 보상 지급 로직:
        // - 추가 보상 5%는 E2S 토큰을 새로 발행(Mint)하여 사용자에게 줍니다.
        // - (개선점: 실패자들의 예치금 풀에서 나눠주도록 고도화할 수 있습니다)
        _mint(msg.sender, rewardAmount);
        
        // 6. 원금 반환: 컨트랙트에 묶여있던 원금을 다시 돌려줍니다.
        require(transfer(msg.sender, session.amount), "Transfer failed");
        
        emit RewardClaimed(msg.sender, totalPayout, rewardAmount);
    }
    
    /**
     * @dev [핵심 기능 3: 포기하기] 데모 시연용 기능으로, 목표를 포기하고 예치금을 몰수당합니다.
     * 발표 포인트: 블록체인 스마트 컨트랙트는 조건에 맞지 않으면 가차없이 예치금을 몰수한다는 것을 보여줍니다.
     */
    function giveUp() external {
        StudySession storage session = sessions[msg.sender];
        require(session.isActive, "No active study session");
        
        // 예치금 수량을 기록만 해두고, 돌려주지 않은 채로 세션만 종료시켜버립니다.
        uint256 slashedAmount = session.amount;
        session.isActive = false;
        
        // 몰수당했다는 이벤트를 발생시킵니다.
        emit StudyFailed(msg.sender, slashedAmount);
    }

    /**
     * @dev [관리자 기능: 세션 강제 종료] 시간이 지나도 클레임하지 않는 악성(?) 유저의 예치금을 관리자가 몰수합니다.
     */
    function failSession(address user) external onlyOwner {
        StudySession storage session = sessions[user];
        require(session.isActive, "No active study session");
        
        // 목표 시간이 끝나고 24시간이 지나도록 클레임하지 않은 경우에만 실행 가능
        require(block.timestamp > session.startTime + session.duration + 1 days, "Grace period not over yet");
        
        uint256 slashedAmount = session.amount;
        session.isActive = false;
        
        emit StudyFailed(user, slashedAmount);
    }
    /**
     * @dev [테스트용 Faucet] 데모 시연을 위해 E2S 테스트 토큰을 무료로 받아가는 수도꼭지 역할입니다.
     */
    function mintForTest() external {
        // 호출한 사람(msg.sender)에게 무조건 1000 E2S를 찍어내서 줍니다.
        _mint(msg.sender, 1000 * 10 ** decimals());
    }
}
