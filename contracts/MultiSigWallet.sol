// SPDX-License-Identifier: MIT
pragma solidity^0.8.28;

contract MultiSigWallet {
    
    event Deposit(address indexed sender, uint amount, uint balance);
    event SubmitTransaction(address indexed owner, uint indexed txIndex, address indexed to, uint value, bytes data);
    event ConfirmTransaction(address indexed owner, uint indexed txIndex);
    event RevokeConfirmation(address indexed owner, uint indexed txIndex);
    event ExecuteTransaction(address indexed owner, uint indexed txIndex, bool success);
    event AddOwner(address indexed owner);
    event RemoveOwner(address indexed owner);
    event ChangeRequirement(uint128 required);

    struct Transaction {
        address to;
        bool executed;
        uint value;
        uint txGasAndBuffer;
        bytes data;
    }

    
    uint128 newNonce = 1;
    uint128 public threshold;

    Transaction[] public transactions;
    address[] public owners;

    mapping(address => bool) public isOwner;
    mapping(address => uint) public ownerNonce;
    mapping(uint => mapping(address => uint)) public isConfirmed;

    modifier onlyOwner(){
       require(isOwner[msg.sender], "You are not an owner!");
       _;
    }

    modifier txExists(uint _txIndex){
        require(_txIndex < transactions.length, "Tx does not exist!");
        _;
    }

    modifier onlyWallet(){
        require(msg.sender == address(this), "You are not the wallet!");
        _;
    }

    constructor(address[] memory _owners, uint128 _threshold){
        require(_owners.length > 0, "The owner list cannot be empty!");
        require(0 < _threshold , "The threshold is unreasonable!");
        require(_threshold <= _owners.length, "The threshold is unreasonable!");
        
        threshold = _threshold;

        for(uint i; i < _owners.length; i ++){
            address owner = _owners[i];
            
            require(owner != address(0), "There cannot be empty address!");
            require(!isOwner[owner], "Address cannot be repeated!");
            
            isOwner[owner] = true;
            owners.push(owner);
            ownerNonce[owner] = newNonce ++;
        }

        require(owners.length <= 10, "Wallets for no more than ten owners!");
    }

    receive() external payable {
        emit Deposit(msg.sender, msg.value, address(this).balance);
    }

    function submitTx(
        address to,
        uint value,
        uint gas,
        bytes calldata data
    )
        external
        onlyOwner 
    {
        transactions.push(Transaction(to, false, value, gas, data));
        uint txIndex = transactions.length -1;
        isConfirmed[txIndex][msg.sender] = ownerNonce[msg.sender];
        emit SubmitTransaction(msg.sender, txIndex, to, value, data);
        emit ConfirmTransaction(msg.sender, txIndex);
    }

    function confirmTx(uint txIndex) 
        external
        onlyOwner
        txExists(txIndex)
    {
        require(!transactions[txIndex].executed, "The transaction has been executed!");
        require(isConfirmed[txIndex][msg.sender] != ownerNonce[msg.sender], "You have confirmed the transaction!");

        isConfirmed[txIndex][msg.sender] = ownerNonce[msg.sender];
        emit ConfirmTransaction(msg.sender, txIndex);
    }

    function executeTx(uint txIndex)
        external
        txExists(txIndex)
    {
        require(
            numConfirmations(txIndex) >= threshold,
            "Not enough numConfirmations!"
        );
        require(!transactions[txIndex].executed,"The transaction has been executed!");
        
        Transaction storage txn = transactions[txIndex];
        address to = txn.to;
        uint value = txn.value;
        uint txGasAndBuffer = txn.txGasAndBuffer;
        bytes memory data = txn.data;
        
        txn.executed = true;
        if(txGasAndBuffer > 0){
            require(gasleft() >= txGasAndBuffer, "Not enough gas provided for the internal call!");
        }
        
        bool success;
        assembly {
            success := call(gas(), to, value, add(data, 0x20), mload(data), 0, 0)
        }

        if(!success) txn.executed = false;
        emit ExecuteTransaction(msg.sender, txIndex, success);
    }

    function revokeConfirmation(uint txIndex)
        external
        onlyOwner
        txExists(txIndex)
    {
        require(!transactions[txIndex].executed,"The transaction has been executed!");
        require(isConfirmed[txIndex][msg.sender] == ownerNonce[msg.sender], "You have not confirmed the transaction!");

        isConfirmed[txIndex][msg.sender] = 0;
        emit RevokeConfirmation(msg.sender, txIndex);
    }

    function changeThreshold(uint128 newNum)
        external
        onlyWallet
    {
        require(0 < newNum , "The newNum is unreasonable!");
        require(newNum <= owners.length, "The newNum is unreasonable!");
        
        _changeThreshold(newNum);
    }    

    function addOwner(address newOwner, bool isAddNCR)
        external
        onlyWallet
    {
        require(newOwner != address(0), "There cannot be empty address!");
        require(!isOwner[newOwner], "Address already exists!");
        require(owners.length < 10, "Wallets for no more than ten owners!");

        owners.push(newOwner);
        isOwner[newOwner] = true;
        ownerNonce[newOwner] = newNonce ++;
        emit AddOwner(newOwner);

        if(isAddNCR){
            _changeThreshold(threshold + 1);
        }
    }

    function removeOwner(address targetOwner)
        external
        onlyWallet
    {
        require(isOwner[targetOwner], "The address is not an owner!");
        require(owners.length > 1, "Not enough owners!");
        
        uint ownersLength = owners.length;
        for(uint i; i < ownersLength; i ++){
            if(owners[i] == targetOwner){
               owners[i] = owners[ownersLength - 1];
               owners.pop();
               isOwner[targetOwner] = false;
               
               break;
            }
        }
        emit RemoveOwner(targetOwner);

        if(threshold > owners.length){
            _changeThreshold(uint128(owners.length));
        }
    }

    function numConfirmations(uint txIndex) 
        public
        view
        txExists(txIndex)
        returns(uint numConfirmation)
    {
        uint length = owners.length;
        for(uint i; i < length; i ++){
            address owner = owners[i];
            if(isConfirmed[txIndex][owner] == ownerNonce[owner]){
                numConfirmation ++;
            }
        }
    }

    function _changeThreshold(uint128 newNum)
        internal
    {
        threshold = newNum;
        emit ChangeRequirement(newNum);
    }    
}


