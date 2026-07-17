// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract EarnToStudy is ERC20, Ownable {
    
    struct StudySession {
        uint256 amount;     // 예치한 토큰 양
        uint256 startTime;  // 공부 시작 시간
        uint256 duration;   // 목표 공부 시간 (초 단위)
        bool isActive;      // 현재 진행 중인지 여부
    }
    
    mapping(address => StudySession) public sessions;
    
    // 보상 비율 (5%)
    uint256 public constant REWARD_PERCENTAGE = 5;
    
    event StudyStarted(address indexed user, uint256 amount, uint256 duration);
    event RewardClaimed(address indexed user, uint256 totalAmount, uint256 rewardAmount);
    event StudyFailed(address indexed user, uint256 slashedAmount);
    
    // Ownable의 생성자 호출 시 msg.sender를 소유자로 설정 (OpenZeppelin 5.x 방식)
    constructor() ERC20("Earn To Study", "E2S") Ownable(msg.sender) {
        // 배포자에게 초기 유동성 공급 (예: 100만 E2S)
        _mint(msg.sender, 1000000 * 10 ** decimals());
    }
    
    /**
     * @dev 사용자가 토큰을 예치하고 공부 목표 시간을 설정합니다.
     * @param amount 예치할 토큰 양
     * @param duration 목표 시간 (초 단위)
     */
    function startStudy(uint256 amount, uint256 duration) external {
        require(amount > 0, "Amount must be greater than 0");
        require(duration > 0, "Duration must be greater than 0");
        require(!sessions[msg.sender].isActive, "Already studying");
        
        // 사용자의 토큰을 스마트 컨트랙트로 전송 (예치)
        // 주의: 프론트엔드에서 사전에 approve를 호출해야 합니다.
        require(transferFrom(msg.sender, address(this), amount), "Transfer failed");
        
        sessions[msg.sender] = StudySession({
            amount: amount,
            startTime: block.timestamp,
            duration: duration,
            isActive: true
        });
        
        emit StudyStarted(msg.sender, amount, duration);
    }
    
    /**
     * @dev 타이머 종료 후 목표를 달성한 사용자가 원금과 5% 보상을 수령합니다.
     */
    function claimReward() external {
        StudySession storage session = sessions[msg.sender];
        require(session.isActive, "No active study session");
        require(block.timestamp >= session.startTime + session.duration, "Study time not finished yet");
        
        // 보상금 계산 (원금의 5%)
        uint256 rewardAmount = (session.amount * REWARD_PERCENTAGE) / 100;
        uint256 totalPayout = session.amount + rewardAmount;
        
        session.isActive = false;
        
        // 원금 + 5% 보상을 사용자에게 전송
        // 자체 발행한 E2S 토큰을 추가로 민팅하여 보상을 지급합니다. 
        // 실패한 사람의 예치금이 컨트랙트에 남게 되므로, 이 자금들이 성공한 사람에게 분배되는 효과를 냅니다.
        _mint(msg.sender, rewardAmount);
        
        // 컨트랙트에 묶여있던 원금 반환
        require(transfer(msg.sender, session.amount), "Transfer failed");
        
        emit RewardClaimed(msg.sender, totalPayout, rewardAmount);
    }
    
    /**
     * @dev (선택 기능) 목표를 달성하지 못한 사용자의 예치금을 실패 처리하고 컨트랙트에 귀속시킵니다.
     * 실패한 사람들의 예치금(원금)은 이 컨트랙트에 그대로 남아, 성공한 사람들의 보상 재원으로 활용됩니다.
     */
    function failSession(address user) external onlyOwner {
        StudySession storage session = sessions[user];
        require(session.isActive, "No active study session");
        
        // 예: 목표 시간이 끝나고 24시간이 지나도록 클레임하지 않은 경우 실패로 간주
        require(block.timestamp > session.startTime + session.duration + 1 days, "Grace period not over yet");
        
        uint256 slashedAmount = session.amount;
        session.isActive = false;
        
        // 예치금은 사용자에게 돌려주지 않고 컨트랙트에 그대로 둡니다. (귀속됨)
        emit StudyFailed(user, slashedAmount);
    }
    
    // (테스트용) 데모 시연을 위해 사용자가 원할 때 언제든 테스트용 토큰을 받을 수 있는 함수
    function mintForTest() external {
        _mint(msg.sender, 1000 * 10 ** decimals());
    }
}
