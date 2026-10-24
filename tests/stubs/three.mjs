/**
 * Stand-in for `three` used by the browser-free boot smoke test.
 * Every export is an auto-stub, so any property access or construction works.
 */

import { stub } from './autoStub.mjs';

export const WebGLRenderer = stub('WebGLRenderer');
export const Scene = stub('Scene');
export const PerspectiveCamera = stub('PerspectiveCamera');
export const FogExp2 = stub('FogExp2');
export const AmbientLight = stub('AmbientLight');
export const DirectionalLight = stub('DirectionalLight');
export const PointLight = stub('PointLight');
export const PlaneGeometry = stub('PlaneGeometry');
export const BoxGeometry = stub('BoxGeometry');
export const SphereGeometry = stub('SphereGeometry');
export const ConeGeometry = stub('ConeGeometry');
export const CylinderGeometry = stub('CylinderGeometry');
export const TorusGeometry = stub('TorusGeometry');
export const TorusKnotGeometry = stub('TorusKnotGeometry');
export const OctahedronGeometry = stub('OctahedronGeometry');
export const ExtrudeGeometry = stub('ExtrudeGeometry');
export const TubeGeometry = stub('TubeGeometry');
export const CircleGeometry = stub('CircleGeometry');
export const BufferGeometry = stub('BufferGeometry');
export const BufferAttribute = stub('BufferAttribute');
export const Shape = stub('Shape');
export const CatmullRomCurve3 = stub('CatmullRomCurve3');
export const Vector3 = stub('Vector3');
export const Color = stub('Color');
export const Group = stub('Group');
export const Mesh = stub('Mesh');
export const Points = stub('Points');
export const Line = stub('Line');
export const MeshStandardMaterial = stub('MeshStandardMaterial');
export const MeshBasicMaterial = stub('MeshBasicMaterial');
export const PointsMaterial = stub('PointsMaterial');
export const LineBasicMaterial = stub('LineBasicMaterial');
export const GridHelper = stub('GridHelper');
export const Clock = stub('Clock');

export const PCFSoftShadowMap = 2;
export const ACESFilmicToneMapping = 4;
export const DoubleSide = 2;
export const BackSide = 1;
export const FrontSide = 0;
export const AdditiveBlending = 2;
export const NormalBlending = 1;

export default stub('THREE');
