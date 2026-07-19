// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title EarnToStudy (E2S) - Group Edition
 * @dev 스터디 그룹을 만들어 다 같이 목표를 공유하고 페널티/보상을 경험하는 플랫폼입니다.
 */
contract EarnToStudy is ERC20, Ownable {
    
    // [상태 정의] 세션의 상태를 구체화하여 프론트엔드에서 직관적으로 파악할 수 있게 합니다.
    enum SessionStatus { None, Active, Success, Failed }

    // [구조체 정의] 개별 사용자의 공부 세션 정보
    struct StudySession {
        uint256 amount;
        uint256 startTime;
        uint256 duration;
        SessionStatus status; // 상태 추가 (진행중, 성공, 실패)
    }
    
    // [구조체 정의] 스터디 그룹 정보
    struct StudyGroup {
        string code;
        address[] members;
    }
    
    mapping(address => StudySession) public sessions;
    
    // [New] 스터디 그룹 관련 상태 변수
    mapping(string => StudyGroup) private groups;
    mapping(address => string) public userToGroup; // 유저가 속한 방 코드
    
    uint256 public constant REWARD_PERCENTAGE = 5;
    
    event GroupCreated(string code, address creator);
    event GroupJoined(string code, address user);
    event StudyStarted(address indexed user, uint256 amount, uint256 duration);
    event RewardClaimed(address indexed user, uint256 totalAmount, uint256 rewardAmount);
    event StudyFailed(address indexed user, uint256 slashedAmount);
    
    constructor() ERC20("Earn To Study", "E2S") Ownable(msg.sender) {
        _mint(msg.sender, 1000000 * 10 ** decimals());
    }
    
    // ==========================================
    // [핵심 기능 0] 스터디 그룹 생성 및 입장
    // ==========================================
    
    /**
     * @dev 새로운 스터디 방을 만듭니다.
     */
    function createGroup(string calldata code) external {
        require(bytes(code).length > 0, "Code cannot be empty");
        require(groups[code].members.length == 0, "Group already exists");
        require(bytes(userToGroup[msg.sender]).length == 0, "Already in a group");
        
        groups[code].code = code;
        groups[code].members.push(msg.sender);
        userToGroup[msg.sender] = code;
        
        emit GroupCreated(code, msg.sender);
    }
    
    /**
     * @dev 기존에 만들어진 방에 들어갑니다.
     */
    function joinGroup(string calldata code) external {
        require(bytes(code).length > 0, "Code cannot be empty");
        require(groups[code].members.length > 0, "Group does not exist");
        require(bytes(userToGroup[msg.sender]).length == 0, "Already in a group");
        
        groups[code].members.push(msg.sender);
        userToGroup[msg.sender] = code;
        
        emit GroupJoined(code, msg.sender);
    }
    
    /**
     * @dev 특정 방의 참여자 지갑 주소 목록을 가져옵니다. (프론트엔드 현황판 렌더링용)
     */
    function getGroupMembers(string calldata code) external view returns (address[] memory) {
        return groups[code].members;
    }

    // ==========================================
    // [핵심 기능 1] 공부 시작 (예치)
    // ==========================================
    function startStudy(uint256 amount, uint256 duration) external {
        require(bytes(userToGroup[msg.sender]).length > 0, "Must join a group first");
        require(amount > 0, "Amount must be greater than 0");
        require(duration > 0, "Duration must be greater than 0");
        require(sessions[msg.sender].status != SessionStatus.Active, "Already studying");
        
        require(transferFrom(msg.sender, address(this), amount), "Transfer failed");
        
        sessions[msg.sender] = StudySession({
            amount: amount,
            startTime: block.timestamp,
            duration: duration,
            status: SessionStatus.Active
        });
        
        emit StudyStarted(msg.sender, amount, duration);
    }
    
    // ==========================================
    // [핵심 기능 2] 보상 수령
    // ==========================================
    function claimReward() external {
        StudySession storage session = sessions[msg.sender];
        require(session.status == SessionStatus.Active, "No active study session");
        require(block.timestamp >= session.startTime + session.duration, "Study time not finished yet");
        
        uint256 rewardAmount = (session.amount * REWARD_PERCENTAGE) / 100;
        uint256 totalPayout = session.amount + rewardAmount;
        
        session.status = SessionStatus.Success; // 성공 상태로 변경
        
        _mint(msg.sender, rewardAmount);
        require(transfer(msg.sender, session.amount), "Transfer failed");
        
        emit RewardClaimed(msg.sender, totalPayout, rewardAmount);
    }
    
    // ==========================================
    // [핵심 기능 3] 포기 및 실패
    // ==========================================
    function giveUp() external {
        StudySession storage session = sessions[msg.sender];
        require(session.status == SessionStatus.Active, "No active study session");
        
        uint256 slashedAmount = session.amount;
        session.status = SessionStatus.Failed; // 실패 상태로 변경 (예치금 귀속)
        
        emit StudyFailed(msg.sender, slashedAmount);
    }

    function failSession(address user) external onlyOwner {
        StudySession storage session = sessions[user];
        require(session.status == SessionStatus.Active, "No active study session");
        require(block.timestamp > session.startTime + session.duration + 1 days, "Grace period not over yet");
        
        uint256 slashedAmount = session.amount;
        session.status = SessionStatus.Failed;
        
        emit StudyFailed(user, slashedAmount);
    }
    
    function mintForTest() external {
        _mint(msg.sender, 1000 * 10 ** decimals());
    }
}
