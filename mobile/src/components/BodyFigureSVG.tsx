import React from "react";
import Svg, { Path, Rect, Ellipse, ClipPath, Defs } from "react-native-svg";
import { BodyParams, BodyGender } from "../data/bodyTypeData";

interface Props {
  params: BodyParams;
  gender: BodyGender;
  uid: string;
  width?: number;
}

export function BodyFigureSVG({ params, gender, uid, width = 54 }: Props) {
  const { sh, ar, ch, wa, hi, th } = params;
  const cx = 40;
  const nk = 5;
  const nB = 26;
  const sY = 33;
  const aY = 56;
  const wY = 85;
  const hpY = 103;
  const tY = 143;
  const cY = 139;
  const height = Math.round((width * 150) / 80);

  const bp = [
    `M ${cx - nk} ${nB}`,
    `C ${cx - nk - 3} ${nB + 5} ${cx - sh} ${sY} ${cx - sh} ${sY}`,
    `C ${cx - sh - ar} ${sY + 9} ${cx - sh - ar - 1} ${aY - 10} ${cx - ch} ${aY}`,
    `C ${cx - wa} ${wY - 8} ${cx - wa} ${wY} ${cx - wa} ${wY}`,
    `C ${cx - wa} ${wY + 8} ${cx - hi} ${hpY - 6} ${cx - hi} ${hpY}`,
    `C ${cx - hi} ${hpY + 14} ${cx - th} ${tY - 14} ${cx - th} ${tY}`,
    `C ${cx - th + 4} ${tY + 2} ${cx - 5} ${cY} ${cx} ${cY}`,
    `C ${cx + 5} ${cY} ${cx + th - 4} ${tY + 2} ${cx + th} ${tY}`,
    `C ${cx + th} ${tY - 14} ${cx + hi} ${hpY + 14} ${cx + hi} ${hpY}`,
    `C ${cx + hi} ${hpY - 6} ${cx + wa} ${wY + 8} ${cx + wa} ${wY}`,
    `C ${cx + wa} ${wY} ${cx + wa} ${wY - 8} ${cx + ch} ${aY}`,
    `C ${cx + sh + ar + 1} ${aY - 10} ${cx + sh + ar} ${sY + 9} ${cx + sh} ${sY}`,
    `C ${cx + sh} ${sY} ${cx + nk + 3} ${nB + 5} ${cx + nk} ${nB}`,
    "Z",
  ].join(" ");

  const isMale = gender === "male";
  const skin = "#C88560";
  const topC = isMale ? "#2563EB" : "#7C3AED";
  const botC = "#1C2341";
  const bandC = isMale ? "#3B82F6" : "#8B5CF6";
  const shirtBot = isMale ? wY + 5 : wY - 7;
  const waistY = isMale ? hpY - 4 : hpY - 6;
  const clipId = `clip-${uid}`;

  return (
    <Svg viewBox="0 0 80 150" width={width} height={height}>
      <Defs>
        <ClipPath id={clipId}>
          <Path d={bp} />
        </ClipPath>
      </Defs>
      <Ellipse cx={40} cy={11} rx={10} ry={10.5} fill={skin} />
      {isMale ? (
        <Rect x={33} y={2} width={14} height={7} rx={3} fill="#3D2810" />
      ) : (
        <Path
          d="M28 13C25 5 30 0 40 0C50 0 55 5 52 13C57 5 57 1 54 1C51 0 46 3 44 9C42 4 41 2 40 2C39 2 38 4 36 9C34 3 29 0 26 1C23 1 23 5 28 13Z"
          fill="#3D2810"
        />
      )}
      <Rect x={cx - nk} y={19} width={nk * 2} height={nB - 17} fill={skin} />
      <Path d={bp} fill={skin} />
      <Rect x={0} y={nB} width={80} height={shirtBot - nB} fill={topC} clipPath={`url(#${clipId})`} />
      <Rect x={0} y={waistY} width={80} height={tY - hpY + 25} fill={botC} clipPath={`url(#${clipId})`} />
      <Rect x={0} y={waistY} width={80} height={5} fill={bandC} clipPath={`url(#${clipId})`} />
      <Path d={bp} fill="none" stroke="rgba(0,0,0,0.1)" strokeWidth={0.8} />
    </Svg>
  );
}
