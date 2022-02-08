/* eslint-disable no-shadow */
/* eslint-disable no-param-reassign */
/* eslint-disable no-unused-vars */
/* eslint-disable no-prototype-builtins */
/* eslint-disable no-nested-ternary */
import React from 'react';
import axios from 'axios';
import flow from 'lodash/flow';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
// Ui
import { withStyles } from '@material-ui/styles';
// Actions
import Modal from '@material-ui/core/Modal';
import Button from '@material-ui/core/Button';
import locale from 'react-json-editor-ajrm/locale/en';
import JSONInput from 'react-json-editor-ajrm';
import { withRouter } from 'react-router';
import InputLabel from '@material-ui/core/InputLabel';
import MenuItem from '@material-ui/core/MenuItem';
import TextField from '@material-ui/core/TextField';
import FormControl from '@material-ui/core/FormControl';
import Select from '@material-ui/core/Select';
import Typography from '@material-ui/core/Typography';
import Tooltip from '@material-ui/core/Tooltip';
import IconButton from '@material-ui/core/IconButton';
import DeleteIcon from '@material-ui/icons/Delete';
import AddIcon from '@material-ui/icons/Add';
import CallSplitIcon from '@material-ui/icons/CallSplit';
import AddBoxIcon from '@material-ui/icons/AddBox';
import {
    getFlows, deleteFlow, updateFlow, startFlow, stopFlow, executeFlow,
} from '../../../action/flows';
import { getComponents } from '../../../action/components';
import { getSecrets } from '../../../action/secrets';
// import OIHFlow from './oihFlowStructure.json';
import styles from './styles.css';
import Loader from '../../loader';
import { getConfig } from '../../../conf';

const conf = getConfig();

const useStyles = {
    flowDetailsContainer: {
        display: 'flex',
        height: 'calc(100vh - 64px)',
        '& hr': {
            border: '1px solid rgba(0,0,0,.8)',
        },
    },
    detailsColumn: {
        // background: 'lightblue',
        flex: '0 0 400px',
        background: 'white',
        borderLeft: '1px solid rgba(0,0,0, .12)',
        padding: '24px 40px',
        height: 'calc(100vh - 64px)',
        overflowY: 'scroll',
    },
    actionsContainer: {
        display: 'flex',
        marginTop: '24px',
        '& .item': {
            width: '100%',
        },
    },
    graphActionsContainer: {
        display: 'flex',
        justifyContent: 'center',
        '& button': {
            margin: '0 4px',
        },
    },
    flowContent: {
        flexGrow: '1',
        padding: '40px',
        display: 'flex',
        justifyContent: 'center',
    },
    flowNode: {
        border: '1px solid blue',
        margin: 20,
        padding: 20,
    },
    flowElement: {
        // border: '1px solid rgba(0,0,0, .12)',
        marginBottom: 10,
        width: '120px',
        borderRadius: '4px',
        background: 'white',
        padding: '8px 16px',
        cursor: 'pointer',
        boxShadow: '0px 2px 1px -1px rgb(0 0 0 / 20%), 0px 1px 1px 0px rgb(0 0 0 / 14%), 0px 1px 3px 0px rgb(0 0 0 / 12%)',
        '&.privileged': {
            background: 'black',
            color: 'white',
        },
    },
    modal: {
        background: 'white',
        position: 'relative',
        padding: '40px',
        height: '80vh',
        width: '680px',
        overflowY: 'scroll',
    },
    formControl: {
        marginTop: 10,
        minWidth: 120,
    },

};

class FlowDetails extends React.PureComponent {
    constructor(props) {
        super(props);
        props.getFlows();
        props.getComponents();
        props.getSecrets();
        this.state = {
            position: '',
            loading: true,
            selectedNode: '',
            component: { name: '' },
            components: '',
            secret: '',
            function: '',
            nodeSettings: {},
            fields: {},
            openModal: false,
            parent: '',
            createNodeName: '',
            leftNodeName: '',
            leftNodeComponent: { name: '' },
            leftNodeAdded: false,
            rightNodeName: '',
            rightNodeComponent: { name: '' },
            rightNodeAdded: false,
            addNodeTriggered: false,
            addBranchEditor: false,
            addBranchAtNode: '',
            flow: {
                graph: {
                    nodes: [],
                    edges: [],
                },
            },
            contentShown: 'flow-settings',
            editNodeName: '',
            editComponent: { name: '' },
            editFunction: '',
            editSecret: '',
            editNodeSettings: '',
            editFields: '',

            prevEdge: '',
        };
    }

    handleChange = (e) => {
        const { value } = e.target;
        switch (e.target.name) {
        case 'flowName':
            this.setState((prevState) => ({
                flow: {
                    ...prevState.flow,
                    name: value,
                },
            }));
            break;
        case 'flowDescription':
            this.setState((prevState) => ({
                flow: {
                    ...prevState.flow,
                    description: value,
                },
            }));
            break;
        case 'flowCron':
            this.setState((prevState) => ({
                flow: {
                    ...prevState.flow,
                    cron: value,
                },
            }));
            break;
        default:

            this.setState({
                ...this.state,
                [e.target.name]: value,
            });
            break;
        }
    }

    async componentDidMount() {
        const { id } = this.props.match.params;

        try {
            const { data } = await axios({
                method: 'get',
                url: `${conf.endpoints.flow}/flows/${id}`,
                withCredentials: true,
            });
            this.setState({ flow: data.data, loading: false, components: this.props.components });
        } catch (err) {
            console.log(err);
        }
    }

    onElementClick = (element) => {
        console.log('onElementClick', element);
        const selectedComponent = this.props.components.all.filter((cp) => cp.id === element.componentId)[0];
        console.log('empty?', selectedComponent);
        this.props.onEditNode && this.props.onEditNode(element.id);
        this.setState({
            selectedNode: element,
            contentShown: 'selected-node',
        });
        this.setState({
            editNodeName: element.id, editFunction: element.function, editFields: element.fields, editNodeSettings: element.nodeSettings, editSecret: element.credential_id, editComponent: selectedComponent || { name: '' },
        });
        if (this.state.components.all.length === 0) {
            this.setState({ components: this.props.components });
        }
    }

    displayModal = (parent) => {
        this.setState({ openModal: true, parent });
    }

    addAfterNode = () => {
        this.setState({ openModal: false });
        const { id } = this.props.match.params;
        const { graph } = this.state.flow;
        const newNodeId = this.state.createNodeName;
        graph.nodes.push({
            id: newNodeId,
            componentId: this.state.component.id,
            function: this.state.function,
            credential_id: this.state.secret,
            nodeSettings: this.state.nodeSettings,
            fields: this.state.fields,
            privileged: this.state.component.hasOwnProperty('specialFlags') ? this.state.component.specialFlags.privilegedComponent : '',
        });
        const parentHasOnlyOneChild = graph.edges.filter((edge) => edge.source === this.state.parent.id).length === 1;

        if (parentHasOnlyOneChild) {
            graph.edges = graph.edges.map((edge) => {
                if (edge.source === this.state.parent.id) {
                    edge.source = newNodeId;
                }
                return edge;
            });
        }

        graph.edges.push({
            source: this.state.parent.id,
            target: newNodeId,
        });
        this.setState({
            flow: {
                ...this.props.flows.all[0],
                graph,
            },
            createNodeName: '',
            component: '',
            // flow: {graph}
        });
    }

  deleteNode = (node) => {
      const { id } = this.props.match.params;
      const { flow } = this.state;
      const edgeToAlter = flow.graph.edges.filter((item) => item.target === node.id);
      // const edgeToDelete = flow.graph.edges.filter(item => item.source === node.id)
      const nodeToDelete = flow.graph.nodes.filter((item) => item.id === node.id);
      const indexNode = flow.graph.nodes.indexOf(nodeToDelete[0]);
      const indexEdge = flow.graph.edges.indexOf(edgeToAlter[0]);
      if (indexNode > -1 && indexEdge > -1) {
          flow.graph.nodes.splice(indexNode, 1);
          flow.graph.edges.splice(indexEdge, 1);
          // this.setState({flow: {...this.state.flow,
          //     flow}})
          this.setState({
              flow: {
                  ...this.state.flow,
                  flow,
              },
              contentShown: 'flow-settings',
          // flow: {graph}
          });
      }
  }

    addBranchAfterNode = () => {
        this.setState({ addBranchEditor: false });
        const { graph } = this.state.flow;

        graph.nodes.push({
            id: this.state.leftNodeName,
            componentId: this.state.component.id,
            function: null,
            fields: {
            },
        });
        graph.nodes.push({
            id: this.state.rightNodeName,
            componentId: this.state.component.id,
            function: null,
            fields: {
            },
        });
        const parentHasOnlyOneChild = graph.edges.filter((edge) => edge.source === this.state.addBranchAtNode.id).length === 1;

        if (parentHasOnlyOneChild) {
            graph.edges = graph.edges.map((edge) => {
                if (edge.source === this.state.addBranchAtNode.id) {
                    edge.source = this.state.leftNodeName;
                }
                return edge;
            });
        }

        graph.edges.push({
            source: this.state.addBranchAtNode.id,
            target: this.state.leftNodeName,
        });
        this.setState({ leftNodeAdded: true });
        graph.edges.push({
            source: this.state.addBranchAtNode.id,
            target: this.state.rightNodeName,
        });
        this.setState({ rightNodeAdded: true });
        this.setState((prevState) => ({
            flow: {
                ...prevState.flow,
                graph,
            },
        }));
        this.setState({ leftNodeAdded: false, rightNodeAdded: false });
        // console.log('this.state.EditComponent', this.state.editComponent);
    }

    openBranchEditor = (node) => {
        this.setState({
            addBranchEditor: true,
            addBranchAtNode: node,
            contentShown: 'add-branch',
        });
    }

  generateSubGraphLeveled = (arr, level) => {
      for (const arrNode of arr[level]) {
          const children = this.props.flows.all[0].graph.nodes.filter((node) => this.props.flows.all[0].graph.edges.find((edge) => edge.source === arrNode.id && edge.target === node.id));
          if (children.length) {
              arr[level + 1] = arr[level + 1] || [];
              arr[level + 1] = arr[level + 1].concat(children);
              this.generateSubGraph(arr, level + 1);
          }
      }

      return arr;
  }

  getImage = (node) => {
      const component = this.state.components.all.filter((comp) => comp.id === node.componentId)[0];
      if (component && component.hasOwnProperty('logo')) {
          return component.logo;
      }
      return false;
  }

    generateGraphVisualization = (currentContent = [], parent, /* isRoot, */ nodeAlignment) => {
        const {
            classes,
        } = this.props;

        const childrenContent = [];
        for (let i = 0; i < parent.children.length; i++) {
            const node = parent.children[i];
            let nodeAlignment = 'center';
            if (i === 0) {
                nodeAlignment = 'left';
            }
            if (parent.children.length === 1) {
                nodeAlignment = 'none';
            }
            if (i === parent.children.length - 1 && parent.children.length > 1) {
                nodeAlignment = 'right';
            }
            childrenContent.push(this.generateGraphVisualization([], node, nodeAlignment));
        }

        // console.log('componentImg', image);
        currentContent.push(<div key={parent.id} className={`${styles.nodeWrapper} ${nodeAlignment}`}>

            {/* {!isRoot ? <button>+</button> : null} */}
            <div className={`${classes.flowElement} ${parent.privileged ? 'privileged' : ''} `} onClick={this.onElementClick.bind(this, parent)}>
                <p style={{ background: '', display: 'flex ', alignItems: 'center' }}>{this.getImage(parent) ? <img src={this.getImage(parent)} style={{ width: '30px', height: '30px', marginRight: 10 }} alt="test"/> : null}{(parent.nodeSettings && parent.nodeSettings.basaasFlows ? parent.nodeSettings.basaasFlows.stepName : parent.id)}</p>
            </div>
            {(parent.children.length && childrenContent.length === 1) ? <div className={styles.childrenWrapper} style={{ position: 'relative' }}><hr style={{ transform: 'rotate(90deg)', width: '20px' }}/>{childrenContent} </div>
                : (parent.children.length && childrenContent.length > 1) ? <div className={styles.childrenWrapper} style={{ position: 'relative' }}><hr style={{ transform: 'rotate(90deg)', width: '20px' }}/><div style={{
                    position: 'absolute', right: 300, top: -30, width: 120,
                }}>{childrenContent[0]}<hr style={{
                        position: 'absolute', left: '120px', top: 32, width: '240px', zIndex: 0,
                    }}/></div><div style={{ position: 'absolute', left: 300, top: -30 }}>
                    <hr style={{
                        position: 'absolute', right: '120px', top: 32, width: '240px', zIndex: 0,
                    }}/>{childrenContent[1]}</div> </div> : null}
            {!parent.children.length ? <div className={classes.graphActionsContainer}>

                <Tooltip title="Add branch">
                    <IconButton color="primary" onClick={() => this.openBranchEditor(parent)}>
                        <CallSplitIcon />
                    </IconButton>
                </Tooltip>

                <Tooltip title="Add Node">
                    <IconButton color="primary" onClick={this.displayModal.bind(this, parent)}>
                        <AddIcon />
                    </IconButton>
                </Tooltip>

                <Tooltip title="Delete Node">
                    <IconButton
                        onClick={this.deleteNode.bind(this, parent)}
                        color="primary"
                        size="small"
                        style={{
                            position: 'absolute', top: '-5px', right: '-19px', zIndex: '1', background: '#ededed',
                        }}
                    >
                        <DeleteIcon />
                    </IconButton>
                </Tooltip>

            </div> : null}

        </div>);
        // console.log('parent', parent);
        return currentContent;
    }

      generateSubGraph = (parent) => {
          const children = this.state.flow.graph.nodes.filter((node) => this.state.flow.graph.edges.find((edge) => edge.source === parent.id && edge.target === node.id));
          parent.children = children || [];
          for (const childNode of parent.children) {
              this.generateSubGraph(childNode);
          }

          return parent;
      }

      generateGraph = () => {
          if (this.state.flow.graph.nodes.length > 0) {
              const flowCopy = this.state.flow;
              const root = flowCopy.graph.nodes.find((node) => !flowCopy.graph.edges.find((edge) => edge.target === node.id));

              if (root) {
                  const arr = [root];
                  this.generateSubGraph(root);
                  return root;
              }
              return null;
          }
          return null;
      }

      handleComponentSelection = (event) => {
          const selected = event.target.value;
          //   console.log('selected is:', selected);
          const component = this.props.components.all.filter((comp) => comp.name === selected)[0];
          switch (event.target.name) {
          case 'editNodeComponent':
              this.setState({ editComponent: component });
              break;
          default:
              this.setState({ component });
              break;
          }
      }

      // test it on monday
      handleSecretSelection = (event) => {
          const selectedSecret = event.target.value;
          console.log('selected secret', selectedSecret);
          if (event.target.name === 'editSecret') {
              this.setState({ editSecret: selectedSecret });
          }
          this.setState({ secret: selectedSecret });
      }

      handleNodeSettings = (event) => {
          this.setState({ nodeSettings: event.jsObject });
      }

      handleFieldsInput = (event) => {
          this.setState({ fields: event.jsObject });
      }

      handleEditNodeSettings = (event) => {
          this.setState({ editNodeSettings: event.jsObject });
      }

      handleEditFieldsInput = (event) => {
          this.setState({ editFields: event.jsObject });
      }

      saveFlow = async () => {
          console.log('Saved', this.state);

          for (let i = 0; i < this.state.flow.graph.nodes.length; i++) {
              console.log(this.state.flow.graph.nodes[i].children);
              delete this.state.flow.graph.nodes[i].children;
          }
          this.props.updateFlow(this.state.flow);
      }

      handleEdit = () => {
          const newFlow = this.state.flow;
          const selNode = this.state.selectedNode;

          const node = this.state.flow.graph.nodes.filter((nod) => nod.id === selNode.id)[0];
          const edge = this.state.flow.graph.edges.filter((edge) => edge.target === selNode.id)[0];

          const newEdge = { ...edge, target: this.state.editNodeName };

          const { nodes } = this.state.flow.graph;
          const { edges } = this.state.flow.graph;
          const indexNode = nodes.findIndex((item) => item.id === selNode.id);
          const newNodes = nodes.filter((item) => item.id !== selNode.id);
          newNodes.splice(indexNode, 0, node);
          //   newNodes.push(node);
          const indexEdge = edges.findIndex((el) => el.target === selNode.id);
          //   console.log('index is', index);
          const newEdges = edges.filter((item) => item.target !== selNode.id);
          newEdges.splice(indexEdge, 0, newEdge);
          //   newEdges.push(newEdge);

          console.log('check state here', this.state.flow);
          const graphCopy = this.state.flow.graph;
          graphCopy.nodes = newNodes;
          graphCopy.edges = newEdges;

          if (this.state.editNodeName) {
              node.id = this.state.editNodeName;
          }

          if (this.state.editComponent) {
              node.componentId = this.state.editComponent.id;
          }
          if (this.state.editFunction) {
              node.function = this.state.editFunction;
          }
          if (this.state.editSecret) {
              node.credential_id = this.state.editSecret;
          }
          if (this.state.editNodeSettings) {
              node.nodeSettings = this.state.editNodeSettings;
          }
          if (this.state.editFields) {
              node.fields = this.state.editFields;
          }
          //   console.log('newFlow here', ...this.state.flow);

          console.log('newFlow', newFlow);
          this.setState((prevState) => ({
              flow: {
                  ...prevState.flow,
                  graph: newFlow.graph,
              },
          }));
          this.setState({
              /* flow: newFlow, */ editNodeName: '', editNodeSettings: {}, editFunction: '', editFields: {}, editSecret: '', contentShown: 'flow-settings',
          });
      }

      //   getDuplicates = (arr, key) => {
      //       const id = arr.map((item) => item.id);
      //       return id.filter((key) => id.indexOf(key) !== id.lastIndexOf(key));
      //   }

      render() {
          //   const items = [
          //       {
          //           name: 'Hans',
          //           id: 1,
          //       }, {
          //           name: 'Selim',
          //           id: 42,
          //       }, {
          //           name: 'Daniel',
          //           id: 100,
          //       }, {
          //           name: 'Jusup',
          //           id: 42,
          //       },
          //       // ...etc.
          //   ];
          //   const duplicates = this.getDuplicates(items, 'id');
          //   console.log('unique', duplicates);
          const {
              classes,
          } = this.props;

          if (this.state.loading) {
              return <Loader />;
          }

          const graph = this.generateGraph();

          if (!graph) {
              return <Loader />;
          }
          const content = this.generateGraphVisualization([], graph, true);
          const selNode = this.state.selectedNode;
          const compId = selNode.componentId;
          const comp = this.state.components.all.filter((cp) => cp.id === compId)[0];
          //   console.log('comp', comp);
          //   console.log('components are', this.state.components);
          console.log('state is', this.state);
          console.log('selNode is', selNode);
          //   const { id } = this.props.match.params;
          return (<React.Fragment>
              {/* CREATE NODE MODAL */}
              <Modal
                  aria-labelledby="simple-modal-title"
                  aria-describedby="simple-modal-description"
                  open={this.state.openModal}
                  onClose={() => this.setState({ openModal: false, component: { name: '' } })}
                  style={{
                      position: 'absolute', left: '25%', top: '10%', width: '680px', height: '80vh',
                  }}
              >

                  <div className={classes.modal}>

                      <Typography variant="h5" component="h2">CREATE NODE</Typography>

                      <TextField
                          id="createNodeName"
                          name="createNodeName"
                          label="Node name"
                          // value={this.state.flow.cron}
                          onChange={(e) => this.handleChange(e)}
                          margin="normal"
                          fullWidth
                          autoFocus
                      />

                      <FormControl className={classes.formControl} style={{ marginTop: '32px', width: '100%' }}>
                          <InputLabel id="demo-simple-select-label">Component</InputLabel>
                          <Select
                              labelId="demo-simple-select-label"
                              id="demo-simple-select"
                              value={this.state.component.name}
                              onChange={(e) => this.handleComponentSelection(e)}
                          >
                              {this.props.components.all.map((component) => <MenuItem value={component.name} key={component.id} >
                                  {component.logo ? <div style={{ display: 'flex', alignItems: 'center' }}>
                                      <img src={component.logo} alt="comp_img" style={{ heigt: 24, width: 24 }}/>
                                      {component.name} {component.hasOwnProperty('specialFlags') ? '(Privileged)' : null }
                                  </div> : <div style={{ display: 'flex', alignItems: 'center' }}>
                                      <AddBoxIcon style={{ height: 24, width: 24 }}/>
                                      {component.name} {component.hasOwnProperty('specialFlags') ? '(Privileged)' : null }
                                  </div>}
                              </MenuItem>)}
                          </Select>
                      </FormControl>

                      <TextField
                          id="function"
                          name="function"
                          label="Function"
                          onChange={(e) => this.handleChange(e)}
                          margin="normal"
                          fullWidth
                      />

                      <FormControl className={classes.formControl} style={{ marginTop: '32px', width: '100%' }}>
                          <InputLabel id="demo-simple-select-label">Secrets</InputLabel>
                          <Select
                              labelId="demo-simple-select-label"
                              id="demo-simple-select"
                              value={this.state.secret}
                              onChange={(e) => this.handleSecretSelection(e)}
                          >
                              {this.props.secrets.secrets.map((secret) => <MenuItem value={secret.name} key={secret.name}>{secret.name}</MenuItem>)}
                          </Select>
                      </FormControl>

                      <Typography variant="subtitle2" component="body1" style={{ display: 'block', marginTop: '40px', marginBottom: '8px' }}>Node Settings (optional)</Typography>
                      <JSONInput
                          id = 'jsonEdit'
                          locale = {locale}
                          theme = 'dark_vscode_tribute'
                          height = '350px'
                          width = '600px'
                          placeholder = {this.dummyData}
                          onChange={(e) => this.handleNodeSettings(e)}
                      />

                      <Typography variant="subtitle2" component="body1" style={{ display: 'block', marginTop: '40px', marginBottom: '8px' }}>Fields (optional)</Typography>
                      <JSONInput
                          id = 'jsonEdit'
                          locale = {locale}
                          theme = 'dark_vscode_tribute'
                          height = '350px'
                          width = '600px'
                          placeholder = {this.dummyData}
                          onChange={(e) => this.handleFieldsInput(e)}
                      />

                      <div className={classes.actionsContainer}>
                          <div className="item">
                              <Button variant="contained" aria-label="Add" onClick={() => this.setState({ openModal: false, component: { name: '' } })} disableElevation>
                                        Close
                              </Button>
                          </div>
                          <div className="item" style={{ display: 'flex', flexDirection: 'row-reverse' }}>
                              <Button variant="contained" color="primary" aria-label="Add" onClick={() => this.addAfterNode()} disabled={!this.state.createNodeName || !this.state.component} disableElevation>
                                        Create
                              </Button>

                          </div>
                      </div>

                  </div>
              </Modal>

              <div className={classes.flowDetailsContainer}>

                  <div className={classes.flowContent}>
                      {content}
                  </div>

                  <aside className={classes.detailsColumn}>

                      {this.state.contentShown === 'flow-settings'
            && <div className="flow-settings">
                <Typography variant="h5" component="h2">Flow Settings</Typography>
                <TextField
                    id="flowID"
                    name="flowID"
                    label="Flow ID"
                    value={this.state.flow.id}
                    // onChange={this.handleChange}
                    margin="normal"
                    fullWidth
                    disabled
                />

                <TextField
                    id="flowName"
                    name="flowName"
                    label="Flow name"
                    value={this.state.flow.name}
                    onChange={this.handleChange}
                    margin="normal"
                    fullWidth
                />

                <TextField
                    id="flowDescription"
                    name="flowDescription"
                    label="Flow description"
                    value={this.state.flow.description}
                    onChange={this.handleChange}
                    margin="normal"
                    fullWidth
                    multiline
                />

                <TextField
                    id="flowCron"
                    name="flowCron"
                    label="Flow Cron"
                    value={this.state.flow.cron}
                    onChange={this.handleChange}
                    margin="normal"
                    fullWidth
                />

                <Button
                    variant="contained"
                    color="primary"
                    onClick={() => this.saveFlow()}
                    disableElevation
                    style={{ marginTop: '40px' }}
                >Save Flow</Button>
            </div>}

                      {this.state.contentShown === 'add-branch' && this.state.addBranchEditor
                && <div className="node-create-branch">
                    <Typography variant="h5" component="h2">Create Branch:</Typography>
                    <TextField
                        id="leftNodeName"
                        name="leftNodeName"
                        label="Left node: Name"
                        value={this.state.leftNodeName}
                        onChange={(e) => this.handleChange(e)}
                        margin="normal"
                        fullWidth
                        autoFocus
                    />
                    {/* <FormControl className={classes.formControl} style={{ marginTop: '32px', width: '100%' }}>
                        <InputLabel id="demo-simple-select-label">Left Component</InputLabel>
                        <Select
                            labelId="demo-simple-select-label"
                            id="demo-simple-select"
                            name="leftNodeNameComponent"
                            value={this.state.leftNodeComponent.name}
                            onChange={(e) => this.handleComponentSelection(e)}
                        >
                            {this.props.components.all.map((component) => <MenuItem value={component.name} key={component.id} >
                                {component.logo ? <div style={{ display: 'flex', alignItems: 'center' }}>
                                    <img src={component.logo} alt="comp_img" style={{ heigt: 24, width: 24 }}/>
                                    {component.name} {component.hasOwnProperty('specialFlags') ? '(Privileged)' : null }
                                </div> : <div style={{ display: 'flex', alignItems: 'center' }}>
                                    <AddBoxIcon style={{ height: 24, width: 24 }}/>
                                    {component.name} {component.hasOwnProperty('specialFlags') ? '(Privileged)' : null }
                                </div>}
                            </MenuItem>)}
                        </Select>
                    </FormControl> */}

                    <TextField
                        id="rightNodeName"
                        name="rightNodeName"
                        label="Right node: Name"
                        value={this.state.rightNodeName}
                        onChange={(e) => this.handleChange(e)}
                        margin="normal"
                        fullWidth
                    />
                    {/* <FormControl className={classes.formControl} style={{ marginTop: '32px', width: '100%' }}>
                        <InputLabel id="demo-simple-select-label">Right Component</InputLabel>
                        <Select
                            labelId="demo-simple-select-label"
                            id="demo-simple-select"
                            value={this.state.rightNodeComponent.name}
                            onChange={(e) => this.handleComponentSelection(e)}
                        >
                            {this.props.components.all.map((component) => <MenuItem value={component.name} key={component.id} >
                                {component.logo ? <div style={{ display: 'flex', alignItems: 'center' }}>
                                    <img src={component.logo} alt="comp_img" style={{ heigt: 24, width: 24 }}/>
                                    {component.name} {component.hasOwnProperty('specialFlags') ? '(Privileged)' : null }
                                </div> : <div style={{ display: 'flex', alignItems: 'center' }}>
                                    <AddBoxIcon style={{ height: 24, width: 24 }}/>
                                    {component.name} {component.hasOwnProperty('specialFlags') ? '(Privileged)' : null }
                                </div>}
                            </MenuItem>)}
                        </Select>
                    </FormControl> */}

                    <div className={classes.actionsContainer}>
                        <div className="item">
                            {/* <button style={{ marginTop: 20 }} onClick={() => this.setState({ addBranchEditor: false, contentShown: 'flow-settings' })}>Cancel</button> */}
                            <Button
                                variant="contained"
                                onClick={() => this.setState({ addBranchEditor: false, contentShown: 'flow-settings' })}
                                disableElevation
                            >Cancel</Button>
                        </div>
                        <div className="item" style={{ display: 'flex', flexDirection: 'row-reverse' }}>
                            {/* <button style={{ marginTop: 20 }} onClick={() => this.addBranchAfterNode()}>CREATE</button> */}
                            <Button
                                variant="contained"
                                color="primary"
                                onClick={() => this.addBranchAfterNode()}
                                disableElevation
                            >Create Node</Button>

                        </div>
                    </div>
                </div>}

                      {this.state.contentShown === 'selected-node' && this.state.selectedNode
                && <div className="node-selected">

                    <Typography variant="h5" component="h2">Edit Node:</Typography>
                    <Typography variant="body" component="span">Selected Node is: {this.state.selectedNode.id}</Typography>

                    <TextField
                        id="editNodeName"
                        name="editNodeName"
                        label="Node name"
                        value={this.state.editNodeName}
                        onChange={(e) => this.handleChange(e)}
                        margin="normal"
                        fullWidth
                    />

                    {/* <input type="text" id="selectedNode" name="selectedNode" value={selNode.id} onChange={(e) => this.handleChange(e)}/> */}

                    <FormControl className={classes.formControl} style={{ marginTop: '32px', width: '100%' }}>
                        <InputLabel id="demo-simple-select-label">Component</InputLabel>
                        <Select
                            labelId="demo-simple-select-label"
                            id="demo-simple-select"
                            name="editNodeComponent"
                            value={this.state.editComponent.name}
                            onChange={(e) => this.handleComponentSelection(e)}
                            fullWidth
                        >
                            {this.props.components.all.map((component) => <MenuItem value={component.name} key={component.id}>{component.logo
                                ? <div style={{ display: 'flex', alignItems: 'center' }}>
                                    <img src={component.logo} alt="comp_img" style={{ heigt: 24, width: 24 }}/>
                                    {component.name} {component.hasOwnProperty('specialFlags') ? '(Privileged)' : null }
                                </div>
                                : <div style={{ display: 'flex', alignItems: 'center' }}>
                                    <AddBoxIcon style={{ height: 24, width: 24 }}/> {component.name} {component.hasOwnProperty('specialFlags') ? '(Privileged)' : null }
                                </div>}
                            </MenuItem>)}
                        </Select>
                    </FormControl>

                    <TextField
                        id="editFunction"
                        name="editFunction"
                        value={this.state.editFunction}
                        label="Function"
                        // value={selNode.id}
                        onChange={(e) => this.handleChange(e)}
                        margin="normal"
                        fullWidth
                    />

                    {/* Function: <input type="text" id="function" name="function" onChange={(e) => this.handleChange(e)}/> */}

                    <FormControl className={classes.formControl} style={{ marginTop: '32px', width: '100%' }}>
                        <InputLabel id="demo-simple-select-label">Secrets</InputLabel>
                        <Select
                            labelId="demo-simple-select-label"
                            id="demo-simple-select"
                            name="editSecret"
                            value={this.state.editSecret}
                            onChange={(e) => this.handleSecretSelection(e)}
                            fullWidth
                        >
                            {this.props.secrets.secrets.map((secret) => <MenuItem value={secret.name} key={secret.name}>{secret.name}</MenuItem>)}
                        </Select>
                    </FormControl>

                    <Typography variant="subtitle2" component="body1" style={{ display: 'block', marginTop: '40px', marginBottom: '8px' }}>Node Settings (optional)</Typography>
                    <JSONInput
                        id = 'jsonEdit'
                        locale = {locale}
                        theme = 'dark_vscode_tribute'
                        height = '350px'
                        width = '100%'
                        // placeholder = {this.dummyData}
                        placeholder={this.state.editNodeSettings}
                        onChange={(e) => this.handleEditNodeSettings(e)}
                        style={{ borderRadius: '4px' }}
                    />

                    <Typography variant="subtitle2" component="body1" style={{ display: 'block', marginTop: '40px', marginBottom: '8px' }}>Fields (optional)</Typography>
                    <JSONInput
                        id = 'jsonEdit'
                        locale = {locale}
                        theme = 'dark_vscode_tribute'
                        height = '350px'
                        width = '100%'
                        placeholder = {this.state.editFields}
                        onChange={(e) => this.handleEditFieldsInput(e)}
                        style={{ borderRadius: '4px' }}
                    />

                    <div className={classes.actionsContainer}>
                        <div className="item">
                            <Button variant="contained" onClick={() => this.setState({ selectedNode: '', contentShown: 'flow-settings' })} disableElevation>Cancel</Button>
                        </div>
                        <div className="item" style={{ display: 'flex', flexDirection: 'row-reverse' }}>
                            <Button variant="contained" color="primary" disableElevation onClick={() => this.handleEdit()}>Save Node</Button>
                        </div>
                    </div>
                </div>}
                  </aside>
              </div>
          </React.Fragment>

          );
      }
}

const mapStateToProps = (state) => ({
    flows: state.flows,
    components: state.components,
    secrets: state.secrets,
});
const mapDispatchToProps = (dispatch) => bindActionCreators({
    getFlows,
    deleteFlow,
    updateFlow,
    startFlow,
    stopFlow,
    executeFlow,
    getComponents,
    getSecrets,
}, dispatch);

export default withRouter(flow(
    connect(
        mapStateToProps,
        mapDispatchToProps,
    ),
    withStyles(useStyles),
)(FlowDetails));
