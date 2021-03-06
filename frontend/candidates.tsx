import * as React from "react";
import * as ReactDOM from "react-dom";
import styled from "styled-components";
import scrollIntoView from "scroll-into-view-if-needed";
import {
  Candidates,
  ServerConnection,
  BeancountTransaction,
  TransactionProperties
} from "./server_connection";
import { AccountInputComponent } from "./account_input";
import { UsedTransactionsComponent } from "./used_transactions";
import { CandidateComponent } from "./candidate";
import { AssociatedDataViewController } from "./app";
import { TransactionEditAction } from "./transaction_line_editor";

const CandidateListElement = styled.div`
  flex: 1;
  overflow-y: scroll;
  flex-basis: 0;
`;

interface CandidatesComponentProps {
  candidates: Candidates;
  candidatesGeneration: number;
  serverConnection: ServerConnection;
  highlightPending: (index: number) => void;
  pendingIndex: number;
  numPending: number;
  accounts: string[];
  associatedDataViewController: AssociatedDataViewController;
}

export type ActiveInputState = {
  type: "account";
  candidateIndex: number;
  groupNumber?: number;
  fieldNumber?: number;
  initial: string;
};

interface CandidatesComponentState {
  disabledUsedTransactions: Set<number>;
  selectedCandidateIndex: number;
  hoverCandidateIndex?: number;
  candidates?: Candidates;
  candidatesGeneration?: number;
  inputState?: ActiveInputState;
}

export class CandidatesComponent extends React.PureComponent<
  CandidatesComponentProps,
  CandidatesComponentState
> {
  state: CandidatesComponentState = {
    disabledUsedTransactions: new Set(),
    selectedCandidateIndex: 0
  };
  private filteredCandidateIndices: number[] = [];
  private globalToFilteredIndex = new Map<number, number>();
  private candidateRefs: (CandidateComponent | null)[] = [];

  static getDerivedStateFromProps(
    props: CandidatesComponentProps,
    state: CandidatesComponentState
  ) {
    const updates: Partial<CandidatesComponentState> = {};
    let hasUpdate = false;
    if (props.candidatesGeneration !== state.candidatesGeneration) {
      Object.assign(updates, {
        candidatesGeneration: props.candidatesGeneration,
        selectedCandidateIndex: 0
      });
      hasUpdate = true;
    }
    if (props.candidates !== state.candidates) {
      Object.assign(updates, {
        candidates: props.candidates,
        inputState: undefined
      });
      hasUpdate = true;
    }
    return hasUpdate ? updates : null;
  }

  handleUsedTransactionsChange = (index: number, value: boolean) => {
    const newDisabled = new Set(this.state.disabledUsedTransactions);
    if (value) {
      newDisabled.delete(index);
    } else {
      newDisabled.add(index);
    }
    this.setState({ disabledUsedTransactions: newDisabled });
  };

  get selectedCandidate() {
    const { candidates } = this.props.candidates;
    return candidates[this.state.selectedCandidateIndex];
  }

  get hoverCandidate() {
    const { hoverCandidateIndex } = this.state;
    if (hoverCandidateIndex === undefined) {
      return undefined;
    }
    const { candidates } = this.props.candidates;
    return candidates[hoverCandidateIndex];
  }

  private requestChangeAccount = (
    candidateIndex: number,
    spec: { groupNumber?: number; fieldNumber?: number }
  ) => {
    if (this.state.inputState !== undefined) {
      return;
    }
    const candidate = this.props.candidates.candidates[candidateIndex];
    const substituted = candidate.substituted_accounts;
    const fieldNumber = substituted.findIndex(
      ([uniqueName, accountName, groupNumber], fieldNumber) =>
        (spec.groupNumber === undefined || groupNumber === spec.groupNumber) &&
        (spec.fieldNumber === undefined || fieldNumber === spec.fieldNumber)
    );
    if (fieldNumber === -1) {
      return;
    }
    const [uniqueName, accountName, groupNumber] = substituted[fieldNumber];
    this.setState({
      inputState: {
        type: "account",
        candidateIndex,
        initial: accountName,
        fieldNumber: spec.fieldNumber,
        groupNumber: spec.groupNumber
      }
    });
  };

  changeAccount = (
    candidateIndex: number,
    newValue: string,
    spec: { groupNumber?: number; fieldNumber?: number }
  ) => {
    const candidate = this.props.candidates.candidates[candidateIndex];
    const substituted = candidate.substituted_accounts;
    let newAccounts: string[];
    if (spec.groupNumber !== undefined) {
      newAccounts = substituted.map(
        ([uniqueName, accountName, groupNumber]) => {
          if (groupNumber === spec.groupNumber) return newValue;
          return accountName;
        }
      );
    } else if (spec.fieldNumber !== undefined) {
      newAccounts = substituted.map(
        ([uniqueName, accountName, groupNumber], fieldNumber) => {
          if (fieldNumber === spec.fieldNumber) return newValue;
          return accountName;
        }
      );
    } else {
      newAccounts = substituted.map(() => newValue);
    }
    this.sendChangeAccounts(candidateIndex, newAccounts);
  };

  private sendChangeAccounts(candidateIndex: number, newAccounts: string[]) {
    const candidate = this.props.candidates.candidates[candidateIndex];
    const transaction = candidate.new_entries[0] as BeancountTransaction;
    this.props.serverConnection.send({
      type: "change_candidate",
      value: {
        generation: this.props.candidatesGeneration,
        candidate_index: candidateIndex,
        changes: {
          accounts: newAccounts,
          tags: transaction.tags,
          links: transaction.links,
          narration: transaction.narration,
          payee: transaction.payee
        }
      }
    });
  }

  private skipToNext = () => {
    this.props.serverConnection.skipBy(1);
  };

  private skipToFirst = () => {
    this.props.serverConnection.skipTo(0);
  };

  private skipToLast = () => {
    this.props.serverConnection.skipTo(-1);
  };

  private skipToPrior = () => {
    this.props.serverConnection.skipBy(-1);
  };

  private retrain = () => {
    this.props.serverConnection.send({ type: "retrain", value: null });
  };

  private changeSelectedCandidateAllAccounts = () => {
    this.requestChangeAccount(this.state.selectedCandidateIndex, {});
  };

  private fixme = () => {
    const { inputState } = this.state;
    if (inputState !== undefined) {
      return;
    }
    const candidate = this.selectedCandidate;
    const substituted = candidate.substituted_accounts;
    if (substituted.length === 0) return;
    const newAccounts = substituted.map(x => x[3]);
    this.sendChangeAccounts(this.state.selectedCandidateIndex, newAccounts);
  };

  private handleAccountInput = (value?: string) => {
    const { inputState } = this.state;
    if (inputState !== undefined) {
      if (value !== undefined && inputState.type === "account") {
        this.changeAccount(inputState.candidateIndex, value, inputState);
      }
    }
    this.setState({ inputState: undefined });
  };

  render() {
    const selectedCandidate = this.selectedCandidate;
    const hoverCandidate = this.hoverCandidate;
    const { disabledUsedTransactions, inputState } = this.state;
    const selectedUsedTransactions =
      selectedCandidate === undefined
        ? []
        : selectedCandidate.used_transaction_ids;
    const hoverUsedTransactions =
      hoverCandidate === undefined ? [] : hoverCandidate.used_transaction_ids;
    const { filteredCandidateIndices, globalToFilteredIndex } = this;
    this.filteredCandidateIndices.length = 0;
    this.globalToFilteredIndex.clear();
    const hasAccountSubstitutions =
      selectedCandidate !== undefined &&
      selectedCandidate.substituted_accounts.length > 0;
    const { numPending, pendingIndex } = this.props;
    let accountInputComponent: any;

    if (inputState !== undefined) {
      const accountSet = new Set(this.props.accounts);
      const candidate = this.props.candidates.candidates[
        inputState.candidateIndex
      ];
      if (candidate !== undefined) {
        const substitutions = candidate.substituted_accounts;
        for (const [
          uniqueName,
          accountName,
          groupNumber,
          originalName
        ] of substitutions) {
          accountSet.add(accountName);
          accountSet.add(originalName);
        }
        for (const entry of candidate.new_entries) {
          if (entry.hasOwnProperty("postings")) {
            for (const posting of (entry as BeancountTransaction).postings) {
              accountSet.add(posting.account);
            }
          }
        }
      }
      accountInputComponent = (
        <AccountInputComponent
          initial={inputState.initial}
          accounts={Array.from(accountSet)}
          onDone={this.handleAccountInput}
        />
      );
    }

    return (
      <React.Fragment>
        <div>
          <button
            disabled={pendingIndex == 0}
            onClick={this.skipToFirst}
            title="Skip to first pending entry"
          >
            ⏮
          </button>
          <button
            disabled={pendingIndex == 0}
            onClick={this.skipToPrior}
            title="Skip to previous pending entry, keyboard shortcut: ["
          >
            ⏪
          </button>
          <button
            disabled={pendingIndex + 1 >= numPending}
            onClick={this.skipToNext}
            title="Skip to next pending entry, keyboard shortcut: ]"
          >
            ⏩
          </button>
          <button
            disabled={pendingIndex + 1 >= numPending}
            onClick={this.skipToNext}
            title="Skip to last pending entry"
          >
            ⏭
          </button>
          <button onClick={this.retrain}>Retrain</button>
          <button
            disabled={!hasAccountSubstitutions}
            onClick={this.changeSelectedCandidateAllAccounts}
            title="Change all unknown accounts to the same value, keyboard shortcut: a"
          >
            Change account
          </button>
          <button
            disabled={!hasAccountSubstitutions}
            onClick={this.fixme}
            title="Reset all unknown accounts of the selected candidate to FIXME accounts, keyboard shortcut: f"
          >
            Fixme later
          </button>
          <button
            disabled={selectedCandidate.original_transaction_properties == null}
            onClick={this.handleEditNarration}
            title="Add link to selected candidate, keyboard shortcut: n"
          >
            Narration
          </button>
          <button
            disabled={selectedCandidate.original_transaction_properties == null}
            onClick={this.handleAddLink}
            title="Add link to selected candidate, keyboard shortcut: ^"
          >
            ^
          </button>
          <button
            disabled={selectedCandidate.original_transaction_properties == null}
            onClick={this.handleAddTag}
            title="Add link to selected candidate, keyboard shortcut: #"
          >
            #
          </button>
          <button
            disabled={selectedCandidate.original_transaction_properties == null}
            onClick={this.handleRevert}
            title="Revert changes to selected candidate"
          >
            Revert
          </button>
        </div>
        <UsedTransactionsComponent
          usedTransactions={this.props.candidates.used_transactions}
          disabledUsedTransactions={this.state.disabledUsedTransactions}
          selectedUsedTransactions={selectedUsedTransactions}
          hoverUsedTransactions={hoverUsedTransactions}
          onChange={this.handleUsedTransactionsChange}
        />
        <CandidateListElement>
          {this.props.candidates.candidates.map((candidate, index) => {
            for (const usedTransactionId of candidate.used_transaction_ids) {
              if (disabledUsedTransactions.has(usedTransactionId)) {
                return null;
              }
            }
            this.globalToFilteredIndex.set(
              index,
              this.filteredCandidateIndices.length
            );
            this.filteredCandidateIndices.push(index);
            return (
              <CandidateComponent
                ref={x => {
                  this.candidateRefs[index] = x;
                }}
                selected={candidate === selectedCandidate}
                hover={index === this.state.hoverCandidateIndex}
                onSelect={this.selectCandidate}
                onAccept={this.acceptCandidate}
                onHover={this.setHoverCandidate}
                inputState={
                  inputState !== undefined &&
                  inputState.candidateIndex === index
                    ? inputState
                    : undefined
                }
                candidate={candidate}
                candidateIndex={index}
                key={index}
                changeAccount={this.requestChangeAccount}
                changeTransactionProperties={
                  this.handleChangeTransactionProperties
                }
              />
            );
          })}
        </CandidateListElement>
        {accountInputComponent}
      </React.Fragment>
    );
  }

  private handleChangeTransactionProperties = (
    candidateIndex: number,
    properties: TransactionProperties
  ) => {
    const candidate = this.props.candidates.candidates[candidateIndex];
    const transaction = candidate.new_entries[0] as BeancountTransaction;
    const substituted = candidate.substituted_accounts;
    const newAccounts = substituted.map(
      ([uniqueName, accountName]) => accountName
    );
    this.props.serverConnection.send({
      type: "change_candidate",
      value: {
        generation: this.props.candidatesGeneration,
        candidate_index: candidateIndex,
        changes: {
          accounts: newAccounts,
          tags: properties.tags,
          links: properties.links,
          narration: properties.narration,
          payee: properties.payee
        }
      }
    });
  };

  componentDidMount() {
    window.addEventListener("keydown", this.handleKeyDown);
  }

  componentWillUnmount() {
    window.removeEventListener("keydown", this.handleKeyDown);
  }

  private handleKeyDown = (event: KeyboardEvent) => {
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement
    ) {
      return;
    }
    switch (event.key) {
      case "[":
        this.skipToPrior();
        break;
      case "]":
        this.skipToNext();
        break;
      case "a":
        this.changeSelectedCandidateAllAccounts();
        break;
      case "f":
        this.fixme();
        break;
      case "t":
        this.retrain();
        break;
      case "1":
        this.requestChangeAccount(this.state.selectedCandidateIndex, {
          groupNumber: 0
        });
        break;
      case "2":
        this.requestChangeAccount(this.state.selectedCandidateIndex, {
          groupNumber: 1
        });
        break;
      case "3":
        this.requestChangeAccount(this.state.selectedCandidateIndex, {
          groupNumber: 2
        });
        break;
      case "4":
        this.requestChangeAccount(this.state.selectedCandidateIndex, {
          groupNumber: 3
        });
        break;
      case "5":
        this.requestChangeAccount(this.state.selectedCandidateIndex, {
          groupNumber: 4
        });
        break;
      case "6":
        this.requestChangeAccount(this.state.selectedCandidateIndex, {
          groupNumber: 5
        });
        break;
      case "7":
        this.requestChangeAccount(this.state.selectedCandidateIndex, {
          groupNumber: 6
        });
        break;
      case "8":
        this.requestChangeAccount(this.state.selectedCandidateIndex, {
          groupNumber: 7
        });
        break;
      case "9":
        this.requestChangeAccount(this.state.selectedCandidateIndex, {
          groupNumber: 8
        });
        break;
      case "0":
        this.requestChangeAccount(this.state.selectedCandidateIndex, {
          groupNumber: 9
        });
        break;
      case "ArrowUp":
        this.selectCandidateRelative(-1);
        break;
      case "ArrowDown":
        this.selectCandidateRelative(1);
        break;
      case "Enter":
        this.acceptCandidate(this.state.selectedCandidateIndex);
        break;
      case "#":
        this.editCurrentTransaction("tag");
        break;
      case "^":
        this.editCurrentTransaction("link");
        break;
      case "n":
        this.editCurrentTransaction("narration");
        break;
      default:
        return;
    }
    event.stopPropagation();
    event.preventDefault();
  };

  private editCurrentTransaction(action: TransactionEditAction) {
    const candidateIndex = this.state.selectedCandidateIndex;
    const candidateRef = this.candidateRefs[candidateIndex];
    if (candidateRef == null) {
      return;
    }
    candidateRef.startEdit(action);
  }

  private acceptCandidate = (candidateIndex: number) => {
    this.props.serverConnection.send({
      type: "select_candidate",
      value: {
        index: candidateIndex,
        generation: this.props.candidatesGeneration
      }
    });
    const candidate = this.props.candidates.candidates[candidateIndex];
    const newEntries = candidate.new_entries;
    if (newEntries.length > 0) {
      this.props.associatedDataViewController.selectFileByMeta(
        newEntries[0]["meta"],
        /*focus=*/ false,
        /*refresh=*/ true
      );
    }
  };

  private selectCandidateRelative(amount: number) {
    this.setState(state => {
      const currentGlobalIndex = state.selectedCandidateIndex;
      const currentFilteredIndex = this.globalToFilteredIndex.get(
        currentGlobalIndex
      )!;
      const { filteredCandidateIndices } = this;
      const newFilteredIndex =
        (currentFilteredIndex + amount + filteredCandidateIndices.length) %
        filteredCandidateIndices.length;
      const newGlobalIndex = filteredCandidateIndices[newFilteredIndex];
      const candidateComponent = this.candidateRefs[newGlobalIndex];
      if (candidateComponent != null) {
        const candidateElement = ReactDOM.findDOMNode(
          candidateComponent
        ) as Element | null;
        if (candidateElement != null) {
          scrollIntoView(candidateElement);
        }
      }
      return {
        selectedCandidateIndex: newGlobalIndex
      };
    });
  }

  private selectCandidate = (candidateIndex: number) => {
    this.setState({ selectedCandidateIndex: candidateIndex });
  };

  private setHoverCandidate = (candidateIndex: number, value: boolean) => {
    this.setState({ hoverCandidateIndex: value ? candidateIndex : undefined });
  };

  private handleRevert = () => {
    const candidateIndex = this.state.selectedCandidateIndex;
    const candidate = this.props.candidates.candidates[candidateIndex];
    const transaction = candidate.new_entries[0] as BeancountTransaction;
    const substituted = candidate.substituted_accounts;
    const newAccounts = substituted.map(
      ([uniqueName, accountName]) => accountName
    );
    this.props.serverConnection.send({
      type: "change_candidate",
      value: {
        generation: this.props.candidatesGeneration,
        candidate_index: candidateIndex,
        changes: {}
      }
    });
  };

  private handleAddLink = () => {
    this.editCurrentTransaction("link");
  };
  private handleAddTag = () => {
    this.editCurrentTransaction("tag");
  };
  private handleEditNarration = () => {
    this.editCurrentTransaction("narration");
  };
}
