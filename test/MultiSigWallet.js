const {expect} = require("chai");
const {ethers} = require("hardhat");
const { 
    loadFixture, 
    impersonateAccount,
    stopImpersonatingAccount 
} = require("@nomicfoundation/hardhat-network-helpers");

describe("MultiSigWallet合约测试", ()=>{
    let owner, owner2, owner3, owner4;

    before(async()=>{
        [
            owner, owner2, owner3, owner4
        ] = await ethers.getSigners();
    });

    async function Deploy(){
        const MultiSigWallet = await ethers.getContractFactory("MultiSigWallet");
        const multiSigWallet = await MultiSigWallet.deploy(
            [owner.address, owner2.address, owner3.address], 
            2
        );
        
        const depositValue = ethers.parseEther("1");
        const address = await multiSigWallet.getAddress();      
        await owner.sendTransaction({to: address, value: depositValue});
        
        return { multiSigWallet };
    }
    
    describe("#constructor", ()=>{
        async function deploy(owners, threshold, reason){
            const MultiSigWallet = await ethers.getContractFactory("MultiSigWallet");
            await expect(
                MultiSigWallet.deploy(owners, threshold)
            ).to.be.revertedWith(reason);
        }
        it("fail: 空名单", async()=>{
            await deploy([], 2, "The owner list cannot be empty!");
        });
        
        it("fail: threshold=0", async()=>{
            await deploy(
                [owner.address, owner2.address, owner3.address],
                0,
                "The threshold is unreasonable!"
            );
        });

        it("fail: threshold>名单人数", async()=>{
            await deploy(
                [owner.address, owner2.address, owner3.address],
                5,
                "The threshold is unreasonable!"
            );
        });

        it("fail: 名单有空地址", async()=>{
            await deploy(
                [owner.address, ethers.ZeroAddress, owner3.address],
                2,
                "There cannot be empty address!"
            );
        });

        it("fail: 名单有重复地址", async()=>{
            await deploy(
                [owner.address, owner.address, owner3.address],
                2,
                "Address cannot be repeated!"
            );
        });

        it("fail: 名单人数>10", async()=>{
            const owners = [];
            for(let i = 0; i < 11; i ++){
                owners.push(ethers.Wallet.createRandom().address);
            };
            await deploy(
                owners,
                5,
                "Wallets for no more than ten owners!"
            );
        });

        it("success: 合法的名单和threshold", async()=>{
            const { multiSigWallet } = await Deploy();
            const address = await multiSigWallet.getAddress();
            expect(address).to.not.equal(ethers.ZeroAddress);
            const code = await ethers.provider.getCode(address);
            expect(code).to.not.equal("0x");

            expect(await multiSigWallet.threshold()).to.equal(2);
            const indexAndAddress = [
                {index: 0, address: owner.address},
                {index: 1, address: owner2.address},
                {index: 2, address: owner3.address}
            ];
            for(const {index, address} of indexAndAddress){
                expect(await multiSigWallet.owners(index)).to.equal(address)
            };
        });
    });

    describe("#function", ()=>{
        let multiSigWallet;
        beforeEach(async()=>{
            ({ multiSigWallet } = await loadFixture(Deploy));
        });

        describe("#receive",()=>{
            it("fail: 有msgdata",async()=>{
                const depositValue = ethers.parseEther("1");
                const address = await multiSigWallet.getAddress();
                
                await expect(
                   owner.sendTransaction({
                    to: address,
                    value: depositValue,
                    data: "0x12345678"
                   })
                ).to.be.reverted;

                expect(
                   await ethers.provider.getBalance(address)
                ).to.equal(depositValue);
            });

            it("success: 无msgdata", async()=>{
                const depositValue = ethers.parseEther("1");
                const balance = ethers.parseEther("2");
                const address = await multiSigWallet.getAddress();
                
                await expect(
                   owner.sendTransaction({
                    to: address,
                    value: depositValue
                   })
                ).to.emit(multiSigWallet, "Deposit")
                .withArgs(owner.address, depositValue, balance);
                expect(
                    await ethers.provider.getBalance(address)
                ).to.equal(balance);
            });
        });

        describe("#onlyOwner", ()=>{
            const onlyOwnerFunction = [
                {funcName: "submitTx", getArgs: () => [ethers.ZeroAddress, 100, 0, "0x"]},
                {funcName: "confirmTx", getArgs: () => [0]},
                {funcName: "revokeConfirmation", getArgs: () => [0]}
            ];
            onlyOwnerFunction.forEach(({funcName, getArgs})=>{
                it(`fail: ${funcName}非管理员地址`, async()=>{
                    await expect(
                        multiSigWallet.connect(owner4)[funcName](...getArgs())
                    ).to.be.revertedWith("You are not an owner!");
                })
            });
        });

        describe("#txExists", ()=>{
            const txExistsFunction = [
                {funcName: "confirmTx", getArgs: () => [5]},
                {funcName: "executeTx", getArgs: () => [6]},
                {funcName: "revokeConfirmation", getArgs: () => [6]},
                {funcName: "numConfirmations", getArgs: () => [7]}
            ];
            txExistsFunction.forEach(({funcName, getArgs})=>{
                it(`fail: ${funcName}不存在交易序号`, async()=>{
                    await expect(
                        multiSigWallet[funcName](...getArgs())
                    ).to.be.revertedWith("Tx does not exist!");
                })
            });
        });

        describe("#onlyWallet", ()=>{
            const onlyWalletFunction = [
                {funcName: "changeThreshold", getArgs: () => [3]},
                {funcName: "addOwner", getArgs: () => [owner4.address, false]},
                {funcName: "removeOwner", getArgs: () => [owner2.address]}
            ];
            onlyWalletFunction.forEach(({funcName, getArgs})=>{
                it(`fail: ${funcName}非钱包地址`, async()=>{
                    await expect(
                        multiSigWallet[funcName](...getArgs())
                    ).to.be.revertedWith("You are not the wallet!");
                })
            });
        });

        async function txProcess(txIndex, isConfirm, isExecute, isfinish,
            txGasAndBuffer = 0, to = owner4.address, data = "0x", value = 100
        ){
            const submit = await multiSigWallet.submitTx(
                to, value, txGasAndBuffer, data
            );
            
            let confirm, execute;
            if(isConfirm){
                await submit.wait();
                confirm = await multiSigWallet.connect(owner2).confirmTx(txIndex);
            };
           
            if(isExecute){
                await confirm.wait();
                execute = await multiSigWallet.executeTx(txIndex);
            };

            if(isfinish){
                await execute.wait();
            };

            return{ submit, confirm, execute };
        }

        describe("#submitTx", ()=>{
            it("success: 管理员调用",async()=>{
                const { submit } = await txProcess(0, false, false, false);
                await expect(submit).to.emit(
                    multiSigWallet, "SubmitTransaction"
                ).withArgs(
                    owner.address, 0, owner4.address, 100, "0x"
                ).and.to.emit(
                    multiSigWallet, "ConfirmTransaction"
                ).withArgs(owner.address, 0);
                
                const transaction = await multiSigWallet.transactions(0)
                
                expect(transaction.to).to.equal(owner4.address);
                expect(transaction.executed).to.equal(false);
                expect(transaction.value).to.equal(100);
                expect(transaction.txGasAndBuffer).to.equal(0);
                expect(transaction.data).to.equal("0x");
                
                expect(
                    await multiSigWallet.isConfirmed(0, owner.address)
                ).to.equal(1);
            });
        });

        describe("#confirmTx",()=>{
            it("fail: 确认已执行交易", async()=>{
                await txProcess(0, true, true, true);
                await expect(
                    multiSigWallet.confirmTx(0)
                ).to.be.revertedWith(
                    "The transaction has been executed!");
            });

            it("fail: 确认已确认过的交易", async()=>{
                await txProcess(0, false, false, false);
                await expect(
                    multiSigWallet.confirmTx(0)
                ).to.be.revertedWith(
                    "You have confirmed the transaction!"
                )
            });

            it("success: 确认未执行未确认交易", async()=>{
                await txProcess(0, false, false, false);

                await expect(
                    multiSigWallet.connect(owner3).confirmTx(0)
                ).to.emit(
                    multiSigWallet, "ConfirmTransaction"
                ).withArgs(owner3.address, 0);

                expect(
                    await multiSigWallet.isConfirmed(0, owner3.address)
                ).to.equal(3);
            });
        });

        describe("#executeTx", ()=>{
            it("fail: 确认人数不够", async()=>{
                await txProcess(0, false, false, false);
                await expect(
                    multiSigWallet.executeTx(0)
                ).to.be.revertedWith(
                    "Not enough numConfirmations!"
                );
            });

            it("fail: gas不够",async()=>{
                await txProcess(0, true, false, false, 2000000);
                await expect(
                    multiSigWallet.executeTx(0, {gasLimit: 500000})
                ).to.be.revertedWith(
                    "Not enough gas provided for the internal call!"
                );
            });

            it("success: txGasAndBuffer>0,gas足够内部调用失败",async()=>{
                const address = await multiSigWallet.getAddress();
                await txProcess(
                    0, true, false, false, 20, address, "0x1234"
                );
                
                await expect(
                    multiSigWallet.executeTx(0)
                ).to.emit(multiSigWallet, "ExecuteTransaction")
                .withArgs(owner.address, 0, false);
                const transaction = await multiSigWallet.transactions(0);
                
                expect(
                    transaction.executed
                ).to.equal(false);
            });

            it("success: txGasAndBuffer=0,内部调用成功",async()=>{
                await txProcess(0, true, false, false);
                
                await expect(
                    multiSigWallet.executeTx(0)
                ).to.emit(multiSigWallet, "ExecuteTransaction")
                .withArgs(owner.address, 0, true);

                const transaction = await multiSigWallet.transactions(0);
                
                expect(
                    transaction.executed
                ).to.equal(true);
            });
        });

        describe("#revokeConfirmation", ()=>{
            it("fail: 已执行的交易", async()=>{
                await txProcess(0, true, true, true);
                await expect(
                    multiSigWallet.revokeConfirmation(0)
                ).to.be.revertedWith(
                    "The transaction has been executed!"
                );
            });

            it("fail: 没确认过这个交易", async()=>{
                await txProcess(0, false, false, false);
                await expect(
                    multiSigWallet.connect(owner2).revokeConfirmation(0)
                ).to.be.revertedWith(
                    "You have not confirmed the transaction!"
                );
            });

            it("fail: 移除又添加的管理员没有之前的确认记录", async()=>{
                await txProcess(0, true, false, false);
                const address = await multiSigWallet.getAddress();

                await impersonateAccount(address);

                const impersonateSigner = await ethers.getSigner(address);
                await multiSigWallet.connect(impersonateSigner)
                .removeOwner(owner2.address);
                await multiSigWallet.connect(impersonateSigner)
                .addOwner(owner2.address, false);

                await stopImpersonatingAccount(address);
                
                await expect(
                    multiSigWallet.connect(owner2).revokeConfirmation(0)
                ).to.be.revertedWith("You have not confirmed the transaction!");
            })

            it("success: 确认过的未执行的交易", async()=>{
                await txProcess(0, true, false, false);
                
                await expect(
                    multiSigWallet.revokeConfirmation(0)
                ).to.emit(multiSigWallet, "RevokeConfirmation")
                .withArgs(owner.address, 0);

                expect(
                    await multiSigWallet.isConfirmed(0, owner.address)
                ).to.equal(0);
            });
        });

        describe("#changeThreshold", ()=>{
            it("fail: newNum为零", async()=>{
                const address = await multiSigWallet.getAddress();
                
                await impersonateAccount(address);

                const impersonateSigner = await ethers.getSigner(address);
                await expect(
                    multiSigWallet.connect(impersonateSigner)
                    .changeThreshold(0)
                ).to.be.revertedWith("The newNum is unreasonable!");

                await stopImpersonatingAccount(address);
            });

            it("fail: newNum>管理员人数", async()=>{
                const address = await multiSigWallet.getAddress();
                
                await impersonateAccount(address);

                const impersonateSigner = await ethers.getSigner(address);
                await expect(
                    multiSigWallet.connect(impersonateSigner)
                    .changeThreshold(5)
                ).to.be.revertedWith("The newNum is unreasonable!");

                await stopImpersonatingAccount(address);
            });

            it("success: 合法newNum", async()=>{
                const data = multiSigWallet.interface.encodeFunctionData("changeThreshold",[3]);
                const address = await multiSigWallet.getAddress();
                const { execute } = await txProcess(0, true, true, false, undefined, address, data, 0);
                await expect(execute).to.emit(multiSigWallet, "ChangeRequirement")
                .withArgs(3);
                expect(await multiSigWallet.threshold()).to.equal(3);
            });
        });

        describe("#addOwner", ()=>{
            it("fail: 空地址", async()=>{
                const address = await multiSigWallet.getAddress();
                
                await impersonateAccount(address);

                const impersonateSigner = await ethers.getSigner(address);
                await expect(
                    multiSigWallet.connect(impersonateSigner)
                    .addOwner(ethers.ZeroAddress, false)
                ).to.be.revertedWith("There cannot be empty address!");

                await stopImpersonatingAccount(address);
            });

            it("fail: 已存在地址", async()=>{
                const address = await multiSigWallet.getAddress();
                
                await impersonateAccount(address);

                const impersonateSigner = await ethers.getSigner(address);
                await expect(
                    multiSigWallet.connect(impersonateSigner)
                    .addOwner(owner.address, false)
                ).to.be.revertedWith("Address already exists!");

                await stopImpersonatingAccount(address);
            });

            it("fail: 管理员满了", async()=>{
                const address = await multiSigWallet.getAddress();
                
                await impersonateAccount(address);

                const impersonateSigner = await ethers.getSigner(address);

                const newOwners = [];
                for(let i = 0; i < 7; i ++){
                    newOwners.push(ethers.Wallet.createRandom().address);
                };
                for(const newOwner of newOwners){
                    await multiSigWallet.connect(impersonateSigner)
                    .addOwner(newOwner, false);
                };
                await expect(
                    multiSigWallet.connect(impersonateSigner)
                    .addOwner(owner4.address, false)
                ).to.be.revertedWith("Wallets for no more than ten owners!");

                await stopImpersonatingAccount(address, false);
            });

            it("success: 不改变threshold", async()=>{
                const address = await multiSigWallet.getAddress();
                
                await impersonateAccount(address);

                const impersonateSigner = await ethers.getSigner(address);
                await expect(
                    multiSigWallet.connect(impersonateSigner)
                    .addOwner(owner4.address, false)
                ).to.emit(multiSigWallet, "AddOwner")
                .withArgs(owner4.address);

                expect(await multiSigWallet.owners(3)).to.equal(owner4.address);
                expect(await multiSigWallet.isOwner(owner4.address)).to.equal(true);
                expect(await multiSigWallet.ownerNonce(owner4.address)).to.equal(4);
                expect(await multiSigWallet.threshold()).to.equal(2);

                await stopImpersonatingAccount(address);
            });

            it("success: threshold+1", async()=>{
                const data = multiSigWallet.interface.
                encodeFunctionData("addOwner", [owner4.address, true]);
                const address = await multiSigWallet.getAddress();
                const { execute } = await txProcess(
                    0, true, true, false, undefined, address, data, 0
                );

                await expect(execute).to.emit(multiSigWallet, "AddOwner")
                .withArgs(owner4.address).and.to.
                emit(multiSigWallet, "ChangeRequirement").withArgs(3);

                expect(await multiSigWallet.owners(3)).to.equal(owner4.address);
                expect(await multiSigWallet.isOwner(owner4.address)).to.equal(true);
                expect(await multiSigWallet.ownerNonce(owner4.address)).to.equal(4);
                expect(await multiSigWallet.threshold()).to.equal(3);
            });
        });
            
        describe("#removeOwner", ()=>{
            it("fail: targetOwner不是owner", async()=>{
                const address = await multiSigWallet.getAddress();

                await impersonateAccount(address);

                const impersonateSigner = await ethers.getSigner(address);
                await expect(
                    multiSigWallet.connect(impersonateSigner)
                    .removeOwner(owner4.address)
                ).to.be.revertedWith("The address is not an owner!");

                await stopImpersonatingAccount(address);
            });

            it("fail: 管理员仅有一人", async()=>{
                const address = await multiSigWallet.getAddress();

                await impersonateAccount(address);

                const impersonateSigner = await ethers.getSigner(address);
                await multiSigWallet.connect(impersonateSigner).removeOwner(owner3.address);
                await multiSigWallet.connect(impersonateSigner).removeOwner(owner2.address);
                
                await expect(
                    multiSigWallet.connect(impersonateSigner)
                    .removeOwner(owner.address)
                ).to.be.revertedWith("Not enough owners!");

                await stopImpersonatingAccount(address);
            });

            it("success: 合法移除管理员,threshold不变", async()=>{
                const address = await multiSigWallet.getAddress();
                const data = multiSigWallet.interface.
                encodeFunctionData("removeOwner", [owner3.address]);
                const { execute } = await txProcess(
                    0, true, true, false, undefined, address, data, 0
                );

                await expect(execute).to
                .emit(multiSigWallet, "RemoveOwner").withArgs(owner3.address);
                
                expect(await multiSigWallet.threshold()).to.equal(2);
            });

            it("success: 合法移除管理员,threshold-1", async()=>{
                const address = await multiSigWallet.getAddress();

                await impersonateAccount(address);

                const impersonateSigner = await ethers.getSigner(address);
                await multiSigWallet.connect(impersonateSigner)
                .removeOwner(owner3.address);
                
                await expect(
                    multiSigWallet.connect(impersonateSigner)
                    .removeOwner(owner2.address)
                ).to.emit(multiSigWallet, "RemoveOwner")
                .withArgs(owner2.address).and.to.
                emit(multiSigWallet, "ChangeRequirement").withArgs(1);
                expect(await multiSigWallet.threshold()).to.equal(1);
            });
        });

        describe("#numConfirmations", ()=>{
            it("success: 查看存在的交易确认人数", async()=>{
                await txProcess(0, true, false, false);
                
                expect(
                    await multiSigWallet.numConfirmations(0)
                ).to.equal(2);
            });

            it("success: 移除又添加的管理员没有之前的确认记录", async()=>{
                await txProcess(0, true, false, false);
                const address = await multiSigWallet.getAddress();

                await impersonateAccount(address);

                const impersonateSigner = await ethers.getSigner(address);
                await multiSigWallet.connect(impersonateSigner)
                .removeOwner(owner2.address);
                await multiSigWallet.connect(impersonateSigner)
                .addOwner(owner2.address, false);

                await stopImpersonatingAccount(address);

                expect(
                    await multiSigWallet.numConfirmations(0)
                ).to.equal(1);
            });
        });
    });
});